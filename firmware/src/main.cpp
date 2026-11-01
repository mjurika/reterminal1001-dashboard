// reTerminal E1001 weather dashboard
//
// - Background (800×480, 1 bpp) is rendered by GitHub Actions and downloaded from GitHub Pages every 30 min.
// - Clock (HH:mm) + indoor SHT4x values are drawn by the device with a partial refresh every minute.
// - Battery level is drawn in the top-right corner (partial refresh when it changes).
// - Battery modes pause the clock 23:00–06:00.
// See ../README.md and ../PLAN.md.

#include <Arduino.h>
#include <Wire.h>
#include <SPI.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <LittleFS.h>
#include <esp_sleep.h>
#include <esp_sntp.h>
#include <driver/gpio.h>
#include <sys/time.h>
#include <GxEPD2_BW.h>

#include "config.h"
#include "secrets.h"
#include "layout.h"
#include "fonts.h"
#include "sensors.h"

static HardwareSerial &Log = Serial1;

#if POWER_MODE == POWER_BATTERY_DEEP
// GxEPD2 resets the controller in init(), which wipes its image RAM. After deep sleep we need that RAM
// for a clean partial refresh, so the driver gets no reset pin and we reset the panel ourselves on cold boot.
static constexpr int16_t EPD_RST_DRIVER = -1;
#else
static constexpr int16_t EPD_RST_DRIVER = EPD_RST;
#endif

GxEPD2_BW<GxEPD2_750_GDEY075T7, GxEPD2_750_GDEY075T7::HEIGHT> display(
    GxEPD2_750_GDEY075T7(EPD_CS, EPD_DC, EPD_RST_DRIVER, EPD_BUSY));

static constexpr size_t BG_BYTES = SCREEN_W * SCREEN_H / 8;
static constexpr const char *BG_FILE = "/bg.bin";
static constexpr uint32_t STATE_MAGIC = 0xD45B0A01;
static constexpr int BATTERY_USB = 101;

// Survives deep sleep (and is a plain global in the other modes).
struct State {
  uint32_t magic;
  char hash[17];        // meta.json hash of the background on screen
  time_t lastFetchOk;   // last successful meta.json check
  time_t lastFetchTry;
  time_t lastNtp;
  uint16_t partials;    // partial refreshes since the last full refresh
  int16_t battery;      // percent shown, BATTERY_USB, or -1 = unknown
  bool staleShown;
  bool nightShown;
};
RTC_DATA_ATTR State st;

static uint8_t *bg = nullptr;  // background bitmap, 1 = black
static bool bgValid = false;

struct Indoor {
  float t, rh;
  bool ok;
};

enum FetchResult { FETCH_FAIL, FETCH_UNCHANGED, FETCH_NEW };

// ---------------------------------------------------------------- time

static bool timeValid() { return time(nullptr) > 1735689600; }  // after 2025-01-01

static void timeFromRtc() {
  time_t e;
  if (rtcRead(e)) {
    struct timeval tv = {e, 0};
    settimeofday(&tv, nullptr);
  } else {
    Log.println("RTC time invalid (no CR1220 backup cell?) - waiting for NTP");
  }
}

static bool ntpSync() {
  sntp_set_sync_status(SNTP_SYNC_STATUS_RESET);
  configTzTime(TZ_INFO, NTP_SERVER1, NTP_SERVER2);
  const uint32_t t0 = millis();
  while (sntp_get_sync_status() != SNTP_SYNC_STATUS_COMPLETED) {
    if (millis() - t0 > 10000) {
      Log.println("NTP timeout");
      return false;
    }
    delay(100);
  }
  st.lastNtp = time(nullptr);
  rtcWrite(st.lastNtp);
  Log.printf("NTP ok, RTC set to %ld\n", (long)st.lastNtp);
  return true;
}

// ---------------------------------------------------------------- network

static bool wifiOn() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  const uint32_t t0 = millis();
  while (WiFi.status() != WL_CONNECTED) {
    if (millis() - t0 > 15000) {
      Log.println("Wi-Fi connect timeout");
      return false;
    }
    delay(100);
  }
  Log.printf("Wi-Fi ok, RSSI %d dBm\n", WiFi.RSSI());
  return true;
}

static void wifiOff() {
  WiFi.disconnect(true);
  WiFi.mode(WIFI_OFF);
}

static bool httpGetString(const String &url, String &out) {
  WiFiClientSecure client;
  client.setInsecure();  // public, non-sensitive data; avoids maintaining a CA bundle
  HTTPClient http;
  http.setTimeout(15000);
  if (!http.begin(client, url)) return false;
  const int code = http.GET();
  if (code == 200) out = http.getString();
  else Log.printf("GET %s -> %d\n", url.c_str(), code);
  http.end();
  return code == 200;
}

static bool httpGetExact(const String &url, uint8_t *buf, size_t len) {
  WiFiClientSecure client;
  client.setInsecure();
  HTTPClient http;
  http.setTimeout(15000);
  if (!http.begin(client, url)) return false;
  const int code = http.GET();
  size_t got = 0;
  if (code == 200 && (http.getSize() < 0 || (size_t)http.getSize() == len)) {
    WiFiClient *s = http.getStreamPtr();
    const uint32_t t0 = millis();
    while (got < len && millis() - t0 < 20000) {
      const size_t avail = s->available();
      if (avail) got += s->readBytes(buf + got, min(avail, len - got));
      else if (!s->connected()) break;
      else delay(5);
    }
  } else {
    Log.printf("GET %s -> %d (size %d)\n", url.c_str(), code, http.getSize());
  }
  http.end();
  return got == len;
}

/** Minimal "key":"value" extraction, enough for meta.json. */
static String jsonString(const String &json, const char *key) {
  const int k = json.indexOf(String('"') + key + '"');
  if (k < 0) return "";
  const int a = json.indexOf('"', json.indexOf(':', k) + 1);
  const int b = json.indexOf('"', a + 1);
  return (a < 0 || b < 0) ? "" : json.substring(a + 1, b);
}

static FetchResult fetchBackground() {
  st.lastFetchTry = time(nullptr);
  if (!wifiOn()) {
    wifiOff();
    return FETCH_FAIL;
  }
  if (!timeValid() || time(nullptr) - st.lastNtp > 24 * 3600) ntpSync();

  FetchResult result = FETCH_FAIL;
  const String bust = "?t=" + String((long)(time(nullptr) / 60));  // bypass the Pages CDN cache
  String meta;
  if (httpGetString(String(DASHBOARD_BASE_URL) + "/meta.json" + bust, meta)) {
    const String hash = jsonString(meta, "hash");
    if (bgValid && hash.length() && hash == st.hash) {
      result = FETCH_UNCHANGED;
    } else {
      uint8_t *tmp = (uint8_t *)ps_malloc(BG_BYTES);
      if (tmp && httpGetExact(String(DASHBOARD_BASE_URL) + "/dashboard.bin" + bust, tmp, BG_BYTES)) {
        memcpy(bg, tmp, BG_BYTES);
        bgValid = true;
        strlcpy(st.hash, hash.c_str(), sizeof(st.hash));
        File f = LittleFS.open(BG_FILE, "w");
        if (f) {
          f.write(bg, BG_BYTES);
          f.close();
        }
        result = FETCH_NEW;
      }
      free(tmp);
    }
  }
  if (result != FETCH_FAIL) st.lastFetchOk = time(nullptr);
  Log.printf("fetch: %s (hash %s)\n", result == FETCH_NEW ? "new" : result == FETCH_UNCHANGED ? "unchanged" : "FAILED", st.hash);
  wifiOff();
  return result;
}

static void loadBackground() {
  File f = LittleFS.open(BG_FILE, "r");
  if (f && f.size() == BG_BYTES) bgValid = f.read(bg, BG_BYTES) == BG_BYTES;
  if (f) f.close();
}

// ---------------------------------------------------------------- sensors

static Indoor readIndoor() {
  Indoor in{};
  in.ok = sht4xRead(in.t, in.rh);
  in.t += INDOOR_TEMP_OFFSET;
  return in;
}

static int readBattery() {
  const float v = batteryVoltage(BATTERY_ADC, BATTERY_EN);
  Log.printf("battery %.2f V\n", v);
  return v >= USB_VOLTAGE_THRESHOLD ? BATTERY_USB : batteryPercent(v);
}

// ---------------------------------------------------------------- drawing

static int16_t textWidth(const GFXfont *font, const char *s) {
  display.setFont(font);
  int16_t x1, y1;
  uint16_t w, h;
  display.getTextBounds(s, 0, 0, &x1, &y1, &w, &h);
  return x1 + w;
}

/** Baseline that vertically centers digits of `font` in `r`; also returns the digit height. */
static int16_t digitBaseline(const Rect &r, const GFXfont *font, int16_t *digitH = nullptr) {
  display.setFont(font);
  int16_t x1, y1;
  uint16_t w, h;
  display.getTextBounds("0", 0, 0, &x1, &y1, &w, &h);
  if (digitH) *digitH = h;
  return r.y + (r.h - (int16_t)h) / 2 - y1;
}

static void drawDegree(int16_t x, int16_t y, int16_t r) {
  for (int16_t i = 0; i < 3; i++) display.drawCircle(x, y, r - i, GxEPD_BLACK);  // 3 px ring
}

static void drawClock(const struct tm *lt, bool blank) {
  char s[6];
  if (blank) strcpy(s, "--:--");
  else snprintf(s, sizeof(s), "%02d:%02d", lt->tm_hour, lt->tm_min);
  display.setFont(&FontClock);
  display.setTextColor(GxEPD_BLACK);
  int16_t x1, y1;
  uint16_t w, h;
  display.getTextBounds("00:00", 0, 0, &x1, &y1, &w, &h);  // fixed box → no jumping between minutes
  const Rect &r = HOLE_CLOCK;
  const int16_t baseline = r.y + (r.h - h) / 2 - y1;
  display.getTextBounds(s, 0, 0, &x1, &y1, &w, &h);
  display.setCursor(r.x + (r.w - (int16_t)w) / 2 - x1, baseline);
  display.print(s);
}

static void drawIndoor(const Indoor &in) {
  char t[12], rh[12];
  if (in.ok) {
    snprintf(t, sizeof(t), "%.1f", in.t);
    for (char *p = t; *p; p++) if (*p == '.') *p = ',';
    snprintf(rh, sizeof(rh), "%d %%", (int)lroundf(in.rh));
  } else {
    strcpy(t, "--,-");
    strcpy(rh, "-- %");
  }
  const int16_t gap = 40, degW = 20;
  const int16_t wt = textWidth(&FontMedium, t), wr = textWidth(&FontMedium, rh);
  const Rect &r = HOLE_INDOOR;
  int16_t x = r.x + (r.w - (wt + degW + gap + wr)) / 2;
  int16_t digitH;
  const int16_t baseline = digitBaseline(r, &FontMedium, &digitH);
  display.setTextColor(GxEPD_BLACK);
  display.setFont(&FontMedium);
  display.setCursor(x, baseline);
  display.print(t);
  drawDegree(x + wt + 10, baseline - digitH + 7, 7);
  x += wt + degW + gap;
  display.setCursor(x, baseline);
  display.print(rh);
}

static void drawBattery(int pct, bool stale) {
  const Rect &r = HOLE_BATTERY;
  const int16_t bw = 30, bh = 15, bx = r.x + r.w - bw - 6, by = r.y + (r.h - bh) / 2;
  display.drawRect(bx, by, bw, bh, GxEPD_BLACK);
  display.drawRect(bx + 1, by + 1, bw - 2, bh - 2, GxEPD_BLACK);
  display.fillRect(bx + bw, by + 4, 3, bh - 8, GxEPD_BLACK);
  char s[8];
  if (pct == BATTERY_USB) {
    display.fillRect(bx + 3, by + 3, bw - 6, bh - 6, GxEPD_BLACK);
    strcpy(s, "USB");
  } else if (pct >= 0) {
    display.fillRect(bx + 3, by + 3, (bw - 6) * pct / 100, bh - 6, GxEPD_BLACK);
    snprintf(s, sizeof(s), "%d %%", pct);
  } else {
    strcpy(s, "?");
  }
  display.setFont(&FontSmall);
  display.setTextColor(GxEPD_BLACK);
  const int16_t baseline = digitBaseline(r, &FontSmall);
  display.setCursor(bx - 6 - textWidth(&FontSmall, s), baseline);
  display.print(s);
  if (stale) {  // background is old (no Wi-Fi / GitHub down)
    display.setCursor(r.x + 2, baseline);
    display.print("!");
  }
}

static Rect clockArea() {
  const int16_t x0 = min(HOLE_CLOCK.x, HOLE_INDOOR.x), y0 = min(HOLE_CLOCK.y, HOLE_INDOOR.y);
  const int16_t x1 = max(HOLE_CLOCK.x + HOLE_CLOCK.w, HOLE_INDOOR.x + HOLE_INDOOR.w);
  const int16_t y1 = max(HOLE_CLOCK.y + HOLE_CLOCK.h, HOLE_INDOOR.y + HOLE_INDOOR.h);
  return {x0, y0, (int16_t)(x1 - x0), (int16_t)(y1 - y0)};
}

template <typename F>
static void partialRefresh(const Rect &r, F draw) {
  display.setPartialWindow(r.x, r.y, r.w, r.h);
  display.firstPage();
  do {
    display.fillRect(r.x, r.y, r.w, r.h, GxEPD_WHITE);
    draw();
  } while (display.nextPage());
  st.partials++;
}

static void fullRefresh(const struct tm *lt, bool blankClock, const Indoor &in) {
  display.setFullWindow();
  display.firstPage();
  do {
    display.fillScreen(GxEPD_WHITE);
    if (bgValid) {
      display.drawBitmap(0, 0, bg, SCREEN_W, SCREEN_H, GxEPD_BLACK);
    } else {
      display.setFont(&FontMedium);
      display.setTextColor(GxEPD_BLACK);
      display.setCursor(420, 260);
      display.print("Cakam na data...");
    }
    drawClock(lt, blankClock);
    drawIndoor(in);
    drawBattery(st.battery, st.staleShown);
  } while (display.nextPage());
  st.partials = 0;
  Log.println("full refresh");
}

// ---------------------------------------------------------------- main logic

static bool isNight(const struct tm &lt) {
  return POWER_MODE != POWER_USB && (lt.tm_hour >= NIGHT_START_HOUR || lt.tm_hour < NIGHT_END_HOUR);
}

/** One update cycle; called every minute. */
static void tick(bool cold) {
  FetchResult fetched = FETCH_UNCHANGED;
  if (cold || !timeValid()) fetched = fetchBackground();  // also syncs NTP

  const time_t now = time(nullptr);
  struct tm lt;
  localtime_r(&now, &lt);
  const bool haveTime = timeValid();
  const bool night = haveTime && isNight(lt);

  if (night && !cold) {
    if (!st.nightShown) {
      partialRefresh(clockArea(), [&] {
        drawClock(&lt, true);
        drawIndoor(readIndoor());
      });
      st.nightShown = true;
    }
    return;
  }
  st.nightShown = night;  // cold boot at night: one full refresh with "--:--", then sleep until morning

  const Indoor in = readIndoor();
  const bool retryDue = now - st.lastFetchOk > 35 * 60 && now - st.lastFetchTry >= FETCH_RETRY_MINUTES * 60;
  if (!cold && (lt.tm_min == FETCH_MINUTE_A || lt.tm_min == FETCH_MINUTE_B || retryDue || !bgValid)) {
    fetched = fetchBackground();
  }

  const bool full = cold || fetched == FETCH_NEW || st.partials >= FULL_REFRESH_EVERY;
  const bool stale = now - st.lastFetchOk > 2 * 3600;
  const int battery = (full || st.battery < 0 || lt.tm_min % BATTERY_UPDATE_MINUTES == 0) ? readBattery() : st.battery;

  if (full) {
    st.battery = battery;
    st.staleShown = stale;
    fullRefresh(&lt, !haveTime || night, in);
    return;
  }
  partialRefresh(clockArea(), [&] {
    drawClock(&lt, !haveTime);
    drawIndoor(in);
  });
  if (battery != st.battery || stale != st.staleShown) {
    st.battery = battery;
    st.staleShown = stale;
    partialRefresh(HOLE_BATTERY, [&] { drawBattery(battery, stale); });
  }
}

/** Microseconds until the next wake-up: next minute boundary, or the end of the night pause. */
static uint64_t sleepMicros() {
  struct timeval tv;
  gettimeofday(&tv, nullptr);
  struct tm lt;
  localtime_r(&tv.tv_sec, &lt);
  if (timeValid() && isNight(lt)) {
    struct tm wake = lt;
    if (lt.tm_hour >= NIGHT_START_HOUR) wake.tm_mday += 1;
    wake.tm_hour = NIGHT_END_HOUR;
    wake.tm_min = 0;
    wake.tm_sec = 1;
    wake.tm_isdst = -1;
    return (uint64_t)(mktime(&wake) - tv.tv_sec) * 1000000ULL;
  }
  return (uint64_t)(60 - lt.tm_sec) * 1000000ULL - tv.tv_usec + 300000;  // land just after the minute flips
}

static void setupHardware(bool cold) {
  Log.begin(115200, SERIAL_8N1, LOG_RX, LOG_TX);
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, HIGH);  // off
  pinMode(SD_CS, OUTPUT);
  digitalWrite(SD_CS, HIGH);    // keep the SD card off the shared SPI bus

  // Release pins held high during deep sleep (set the level first to avoid a glitch).
  digitalWrite(EPD_RST, HIGH);
  pinMode(EPD_RST, OUTPUT);
  digitalWrite(EPD_CS, HIGH);
  pinMode(EPD_CS, OUTPUT);
  gpio_hold_dis((gpio_num_t)EPD_RST);
  gpio_hold_dis((gpio_num_t)EPD_CS);

  setenv("TZ", TZ_INFO, 1);
  tzset();

  Wire.begin(I2C_SDA, I2C_SCL);
  if (cold) rtcInit();
  timeFromRtc();

  LittleFS.begin(true);
  bg = (uint8_t *)ps_malloc(BG_BYTES);
  loadBackground();

#if POWER_MODE == POWER_BATTERY_DEEP
  if (cold) {  // the driver has no reset pin in this mode
    digitalWrite(EPD_RST, LOW);
    delay(10);
    digitalWrite(EPD_RST, HIGH);
    delay(10);
  }
#endif
  SPI.begin(EPD_SCK, -1, EPD_MOSI, EPD_CS);
  display.epd2.selectSPI(SPI, SPISettings(4000000, MSBFIRST, SPI_MODE0));
  display.init(0, cold);  // initial=false after deep sleep: panel content and controller RAM are kept
}

void setup() {
  const bool timerWake = esp_sleep_get_wakeup_cause() == ESP_SLEEP_WAKEUP_TIMER;
  const bool cold = !timerWake || st.magic != STATE_MAGIC;
  if (cold) {
    memset(&st, 0, sizeof(st));
    st.magic = STATE_MAGIC;
    st.battery = -1;
  }
  setupHardware(cold);
  Log.printf("\nboot (%s), power mode %d\n", cold ? "cold" : "timer wake", POWER_MODE);
  if (!bg) Log.println("PSRAM allocation failed - enable OPI PSRAM");

  tick(cold);

#if POWER_MODE == POWER_BATTERY_DEEP
  display.powerOff();  // not hibernate(): keeps the controller RAM for the next partial refresh
  gpio_hold_en((gpio_num_t)EPD_RST);
  gpio_hold_en((gpio_num_t)EPD_CS);
  gpio_deep_sleep_hold_en();
  const uint64_t us = sleepMicros();
  Log.printf("deep sleep %llu s\n", us / 1000000ULL);
  Log.flush();
  esp_sleep_enable_timer_wakeup(us);
  esp_deep_sleep_start();
#endif
}

void loop() {
  const uint64_t us = sleepMicros();
#if POWER_MODE == POWER_BATTERY_LIGHT
  display.powerOff();
  Log.flush();
  esp_sleep_enable_timer_wakeup(us);
  esp_light_sleep_start();
  timeFromRtc();  // the light-sleep clock drifts; the PCF8563 crystal doesn't
#else
  delay(us / 1000);
#endif
  tick(false);
}
