# reTerminal E1001 Weather Dashboard — Project Plan

## 1. Goal

An 800×480 black-and-white e-paper dashboard on the Seeed **reTerminal E1001**:

| Area | Content | Produced by | Refresh |
|---|---|---|---|
| Clock | `HH:mm` | Device (PCF8563 RTC, synced from NTP) | **Partial refresh** every minute |
| Indoor | Temperature + humidity | Device (onboard SHT4x) | **Partial refresh**, together with the clock |
| Battery | Level icon + % in a corner | Device (battery ADC) | **Partial refresh**, every 10 min or on change |
| Date | `DD/MM` + weekday | Background image (lag of up to ~30 min after midnight is OK) | With the background |
| Current outdoor | Temperature, humidity, wind (km/h) from METAR **LZIB** | Background image | Every 30 min |
| Next 8 hours | Temperature, weather symbol, precipitation chance, 1h precipitation amount | Background image | Every 30 min |
| Next 3 days | Min/max temperature, symbol, chance of rain during the day | Background image | Every 30 min |

The GitHub side renders the **background** with empty, fixed-position "holes" (clock, indoor, battery). The device shows the background with a full refresh, then redraws only the holes with **partial refreshes**.

### Decisions so far
- Location: **LZIB** (48.170 N, 17.213 E) for both the METAR and the forecast.
- Wind in **km/h**.
- Pure **black & white** (1 bit per pixel). No grayscale.
- Power: support **both USB and battery**. Show the battery level on screen and decide later.
- Data: **Open-Meteo** only. No raw SHMU/GRIB processing.
- Backend: runs entirely on free GitHub (Actions + Pages). Language: **Node.js + TypeScript**, which fits an HTML/CSS workflow.
- No Home Assistant, so the firmware uses **Arduino (PlatformIO)**, not ESPHome.
- Buttons: none for now. Keep them as a later option (e.g. a second page).
- Labels in **Slovak**.
- 3-day block **starts tomorrow**.
- Battery modes **pause the clock 23:00–06:00**.

---

## 2. Hardware facts (from the Seeed wiki)

| Item | Value |
|---|---|
| MCU | ESP32-S3, 8 MB OPI PSRAM, 32 MB flash |
| Display | 7.5" monochrome e-paper, 800×480, panel GDEY075T7, driver **UC8179**. **Supports partial refresh** (Seeed's E-series overview lists partial update for the E1001; the colour E1002 does not have it). |
| E-paper SPI | SCK GPIO7, MOSI GPIO9, CS GPIO10, DC GPIO11, RST GPIO12, BUSY GPIO13 |
| I2C bus | SDA GPIO19, SCL GPIO20, shared by the sensor and the RTC |
| Temp/humidity | SHT4x @ `0x44` |
| RTC | **NXP PCF8563** @ `0x51`, 32.768 kHz crystal. Backup cell **CR1220, not included**: buy one. The VL flag means the time is invalid and should be resynced via NTP. The INT pin GPIO is not documented, so do not rely on it for wake-up. |
| Battery | 2000 mAh LiPo. Read the voltage via ADC **GPIO1** with enable **GPIO21** (HIGH → wait 5 ms → `analogReadMilliVolts` → LOW). The divider is **×2**, 12-bit, 11 dB attenuation. Expect 4.2 V full and about 3.3 V empty. There is **no charge-status pin**. |
| Deep sleep | About **14 µA** measured by Seeed. Wake sources: timer, and buttons (GPIO0–21 only, e.g. KEY0 = GPIO3). |
| Buttons | GPIO3 (right/KEY0), GPIO4 (middle), GPIO5 (left), active-low |
| Other | Buzzer GPIO45, LED GPIO6 (active-low), microSD, USB-C |
| Debug UART | Serial1, GPIO43 TX / GPIO44 RX, 115200 baud |

Seeed wiki pages:
- [Getting started (E1001)](https://wiki.seeedstudio.com/getting_started_with_reterminal_e1001/)
- [Arduino: display](https://wiki.seeedstudio.com/reterminal_e10xx_with_arduino/), using the Seeed_GFX or [Seeed_GxEPD2](https://github.com/Seeed-Projects/Seeed_GxEPD2/) library
- [Arduino: peripherals](https://wiki.seeedstudio.com/reterminal_e10xx_with_arduino_peripherals/) (SHT4x, battery, buttons, SD)
- [Arduino: RTC & low power](https://wiki.seeedstudio.com/reterminal_e10xx_with_arduino_peripherals_2/)
- [E-series overview](https://wiki.seeedstudio.com/reterminal_e10xx_main_page/)

---

## 3. Architecture

### 3.1 GitHub Pages is static, so pre-render on a schedule

GitHub Pages only serves files. A GitHub Actions cron job builds the background and publishes it as static files. For the device, that is the "API".

```
                 ┌──────────────────────── GitHub (free, public repo) ───────────┐
 cron 5,35 * * * │ GitHub Actions workflow (Node + TS)                           │
 + manual run    │  1. fetch METAR LZIB          (aviationweather.gov)           │
                 │  2. fetch forecast            (Open-Meteo)                    │
                 │  3. build data.json                                           │
                 │  4. render template/dashboard.html → 800×480 PNG (Playwright) │
                 │  5. threshold to 1-bit → dashboard.png + dashboard.bin        │
                 │  6. deploy to GitHub Pages (+ preview page, meta.json)        │
                 └───────────────────────────────┬───────────────────────────────┘
                                                 │ HTTPS, static files
                https://<user>.github.io/<repo>/dashboard.bin   ← device
                https://<user>.github.io/<repo>/                ← preview in browser
                                                 │
                 ┌───────────────── reTerminal E1001 (Arduino) ──────────────────┐
                 │ every ~30 min: meta.json changed? → download .bin → FULL      │
                 │ every minute:  RTC → HH:mm, SHT4x → T/RH → PARTIAL (clock box)│
                 │ every 10 min:  battery ADC → PARTIAL (battery box)            │
                 │ daily / VL flag: NTP → PCF8563 (TZ Europe/Bratislava)         │
                 └───────────────────────────────────────────────────────────────┘
```

**GitHub Actions cron caveats**
- Runs are often **5–20 minutes late** and are occasionally skipped. That is acceptable for 30-min METAR data. If it becomes a problem, add a free external trigger (cron-job.org → `workflow_dispatch` API with a fine-grained token).
- Scheduled workflows **stop after 60 days without repo activity**. Add a keep-alive step: a monthly empty commit, or the `gautamkrishnar/keepalive-workflow` action.
- Use a **public repo**. Actions minutes are then unlimited, and Pages is free.

### 3.2 What runs where

| Component | Runs on | Tools |
|---|---|---|
| Data fetch → `data.json` | GitHub Actions (ubuntu-latest) | Node 22, TypeScript, `fetch` |
| Layout | HTML + CSS template | Your code |
| Render to PNG | GitHub Actions, headless Chromium | Playwright |
| 1-bit conversion | GitHub Actions | `sharp` |
| Hosting | GitHub Pages | `actions/deploy-pages` |
| Layout development | Your PC / browser | `npm run dev` (Vite or a simple live-server) |
| Firmware | reTerminal ESP32-S3 | PlatformIO + Arduino-ESP32 + Seeed_GxEPD2 |

### 3.3 Files published on Pages

| File | Purpose |
|---|---|
| `dashboard.bin` | Raw 1 bpp, row-major, MSB first, 1 = black (match GxEPD2's `drawBitmap` convention). 800×480/8 = **48,000 bytes**. The device needs no PNG decoder. |
| `dashboard.png` | The same image as a 1-bit PNG, for humans |
| `meta.json` | `{ generated, metarTime, modelRun, hash }`. The device compares `hash` and skips the download and full refresh when nothing changed. |
| `data.json` | Raw data, for debugging |
| `index.html` | Preview page: the PNG plus a simulated clock, indoor values and battery in the holes, plus the raw data |
| `layout.json` | Hole positions, also compiled into the firmware |

Render text with **threshold, not dithering**, so it stays crisp. Icons must be pure B/W SVG or an icon font.

---

## 4. Data sources

### 4.1 METAR LZIB (current conditions)
- `https://aviationweather.gov/api/data/metar?ids=LZIB&format=json`. Free, no key. Send a descriptive `User-Agent`.
- Fields: `temp`, `dewp` (°C), `wdir`, `wspd`, `wgst` (kt), `obsTime`, `rawOb`.
- **RH is computed** from T and Td with the Magnus formula: `RH = 100·exp(17.625·Td/(243.04+Td)) / exp(17.625·T/(243.04+T))`.
- **Wind km/h = kt × 1.852.** Show the direction as a compass point (e.g. SW), plus gusts if present. Handle `VRB` and calm.
- LZIB reports at :00 and :30, so the workflow cron is `5,35 * * * *`.
- Fallback: `https://tgftp.nws.noaa.gov/data/observations/metar/stations/LZIB.TXT`. Parse the raw METAR string.
- If the METAR is older than 90 min, show it greyed out (striped) or with a "stale" marker.

### 4.2 Forecast: Open-Meteo (free for non-commercial use, no key)
Plan: up to 3 requests per run (≈ 150/day, far below the 10k/day limit).

| Block | Model | Variables |
|---|---|---|
| Next 8 h | **CHMI ALADIN CE 2 km** (local ALADIN family, covers Bratislava). Fallback: ECMWF IFS 9 km. | `temperature_2m`, `precipitation` (1h), `weather_code`, `is_day` |
| Next 8 h, rain chance | ECMWF ensemble (or `best_match`) | `precipitation_probability` (share of members with >0.1 mm in the hour) |
| Next 3 days | **ECMWF IFS 9 km** | daily `temperature_2m_min/max`, `weather_code`, `precipitation_probability_max`, `precipitation_sum` |

Example (**verify exact model IDs** on https://open-meteo.com/en/docs and https://open-meteo.com/en/docs/ecmwf-api in M2):
```
https://api.open-meteo.com/v1/forecast?latitude=48.170&longitude=17.213
  &hourly=temperature_2m,precipitation,precipitation_probability,weather_code,is_day
  &daily=temperature_2m_max,temperature_2m_min,weather_code,precipitation_probability_max,precipitation_sum
  &timezone=Europe/Bratislava&forecast_days=4&models=ecmwf_ifs
```
- "Next 8 hours" starts at the next full hour after generation.
- "Next 3 days" means tomorrow plus the following 2 days. *(Alternative: today plus 2 days. Decide during layout.)*
- Attribution: put "Weather data © Open-Meteo (CC BY 4.0), METAR: NOAA AWC" in a small footer.

### 4.3 Weather symbols
WMO `weather_code` maps to an icon, with day/night variants from `is_day`. Candidate icon sets:
- [Weather Icons (Erik Flowers)](https://github.com/erikflowers/weather-icons): an icon font (SIL OFL) that renders perfectly in 1-bit.
- [Meteocons](https://github.com/basmilius/weather-icons) line variants (MIT). These need a B/W conversion.

Size: about 56 px in the hourly row and about 80 px in the day blocks.

---

## 5. Proposed layout (800×480)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ ┌────────────────────────────┐ SUN       │ LZIB  METAR 14:30          ┌─────┐ │
│ │                            │ 01/11     │  ☁  8 °C                   │▮▮▮▯ │ │
│ │     HH:mm   (device)       │           │  RH 76 %                   │ 78% │ │
│ │     ~336×136 px            │           │  Wind SW 14 km/h, G 25     └─────┘ │
│ ├────────────────────────────┤           │                       battery(dev) │
│ │ IN 22.4 °C   48 %  (device)│           │                                    │
│ └────────────────────────────┘           │                                    │
├──────────────────────────────────────────────────────────────────────────────┤
│  15    16    17    18    19    20    21    22          ← next 8 hours (8×100) │
│  ☁     🌦     🌧     🌧     ☁     ☁     ☾     ☾                                 │
│  9°    9°    8°    8°    7°    7°    6°    6°                                 │
│  20%   60%   80%   70%   30%   10%   0%    0%                                 │
│  –     0.4   1.2   0.8   0.1   –     –     –    mm                            │
├──────────────────────────────────────────────────────────────────────────────┤
│   MON 02/11              TUE 03/11              WED 04/11   ← 3 days (3×266)  │
│   🌧  4° / 10°  70 %      ⛅  2° / 9°  20 %       ☀  0° / 11°  0 %               │
├──────────────────────────────────────────────────────────────────────────────┤
│ updated 14:35 · CHMI ALADIN / ECMWF · © Open-Meteo, NOAA                      │
└──────────────────────────────────────────────────────────────────────────────┘
```

**Holes (device-drawn, partial refresh), defined once in `layout.json`:**

| Hole | Approx. box (x, y, w, h) | Updated |
|---|---|---|
| `clock` + `indoor` (one window, so one refresh per minute) | 8, 8, 336, 180 | every minute |
| `battery` | 704, 8, 88, 56 | every 10 min / on change |

Rules:
- Make **x and w multiples of 8**, because UC8179 partial windows are byte-aligned. The renderer should fail the build if they are not.
- The HTML template draws the holes as empty white boxes (with an optional thin frame drawn by the background), absolutely positioned from `layout.json`.
- The preview page overlays fake values with the same fonts, so you can judge the final look without the device.
- Fonts: bold, condensed sans (e.g. Barlow Condensed / Roboto Condensed / Inter Bold). Convert the clock font to an Adafruit-GFX font (`fontconvert`) from the **same typeface** so device text matches the background.

---

## 6. Repository setup (testable without the device)

### 6.1 Structure
```
reterminal-dashboard/
├─ .github/workflows/
│  ├─ render.yml         # cron 5,35 * * * * + workflow_dispatch → build → deploy Pages
│  └─ ci.yml             # PR/push: build from fixtures, upload PNG as artifact
├─ src/
│  ├─ fetch/metar.ts      # LZIB → {tempC, dewC, rh, windKmh, gustKmh, dir, time}
│  ├─ fetch/forecast.ts   # Open-Meteo → {hours[8], days[3]}
│  ├─ wmo.ts              # weather_code → icon + label
│  ├─ build-data.ts       # → out/data.json (+ --fixtures flag for offline)
│  ├─ render.ts           # Playwright: template + data → out/raw.png (800×480)
│  └─ to-1bit.ts          # sharp threshold → dashboard.png, dashboard.bin, meta.json
├─ template/
│  ├─ dashboard.html      # 800×480 fixed viewport, reads data.json
│  ├─ dashboard.css
│  └─ icons/ fonts/
├─ preview/index.html     # PNG + simulated holes + data table
├─ layout.json            # holes, shared with firmware
├─ fixtures/              # recorded METAR + Open-Meteo responses (sunny, rain, snow, stale)
├─ firmware/              # PlatformIO project
│  ├─ platformio.ini
│  ├─ include/secrets.h.example
│  └─ src/main.cpp
├─ package.json  tsconfig.json  README.md
```

### 6.2 Local layout loop
1. `npm install` (installs Playwright Chromium and sharp).
2. `npm run dev` serves `template/dashboard.html` with fixture data, with live reload. Edit HTML/CSS at exactly 800×480. Add a `?bw=1` toggle that applies a CSS threshold-like filter to preview the 1-bit look.
3. `npm run fetch` fetches live data into `out/data.json`.
4. `npm run render` writes `out/dashboard.png` and `.bin`, exactly as CI does.

### 6.3 GitHub setup steps
1. Create a **public** repo `reterminal-dashboard` and push the skeleton.
2. Go to **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. In `render.yml`, give the deploy job `permissions: { pages: write, id-token: write }`, use `actions/upload-pages-artifact` + `actions/deploy-pages`, and set `concurrency: pages`.
4. No secrets are needed. Keep the station and coordinates in `config.json`.
5. Go to **Actions → render → Run workflow**, then open `https://<user>.github.io/reterminal-dashboard/`.
6. Add keep-alive (see 3.1). Optionally add an external trigger later.

---

## 7. Device firmware (Arduino / PlatformIO)

### 7.1 Libraries
- **Seeed_GxEPD2** (a GxEPD2 fork with the E1001 board config, `GDEY075T7` / UC8179). It provides full and **partial window** refresh.
- `Sensirion I2C SHT4x` for the sensor, `Wire` for the PCF8563 (raw registers, as in the Seeed example), `HTTPClient` + `WiFiClientSecure`, and `ArduinoJson` for `meta.json`.
- Build settings: ESP32-S3, **OPI PSRAM enabled**, 16 MB+ partition scheme.

### 7.2 Partial refresh, the core of the clock
```cpp
display.setPartialWindow(L.clock.x, L.clock.y, L.clock.w, L.clock.h); // x,w multiple of 8
display.firstPage();
do {
  display.fillRect(L.clock.x, L.clock.y, L.clock.w, L.clock.h, GxEPD_WHITE);
  drawClock(hh, mm);        // big GFX font
  drawIndoor(t, rh);        // smaller font, same window
} while (display.nextPage());
```
- A full refresh (`setFullWindow()`) happens only when a new background arrives, and also **every ~30–60 partials** to clear ghosting. With a 30-min background cycle this happens naturally.
- **Deep-sleep caveat (test in M4):** UC8179 partial refresh compares against the controller's "old" image RAM. After `hibernate()` or a power-off, that RAM is lost, which can leave artifacts in the window. Options, in order of preference:
  1. Call `display.init(115200, /*initial=*/false)` after waking, and redraw the full window content each time (the box is white-filled first). Check whether the result is clean.
  2. Keep the previous window bitmap in RTC/PSRAM-retained memory and write it as the "previous" image before the partial refresh (GxEPD2 `writeImagePrevious`-style).
  3. Battery mode: use **light sleep** with the panel only `powerOff()`-ed (RAM retained) instead of deep sleep. This costs more current but gives guaranteed clean partials.

### 7.3 Runtime logic
```
setup / wake:
  init I2C, SHT4x, PCF8563 (if VL flag or first boot → NTP sync), display (initial=false after wake)
  t = RTC time (TZ "CET-1CEST,M3.5.0,M10.5.0/3")

every minute (wake aligned to second 00):
  read SHT4x → partial refresh clock+indoor window
  if minute % 10 == 0: read battery → partial refresh battery window

at minute 08 and 38 (≈3 min after the GitHub job usually finishes; also retried at +10 min):
  Wi-Fi on → GET meta.json → hash changed? → GET dashboard.bin (48 kB into PSRAM)
  → full refresh (background + holes drawn together) → Wi-Fi off
  once a day: NTP → write PCF8563

errors: keep the old background; draw a small "!" + data age in the battery box
```

### 7.4 Power modes (both supported, selectable by a build flag; auto-detection is possible later)

| Mode | Behaviour |
|---|---|
| `POWER_USB` | Stays awake, Wi-Fi off between fetches, partial refresh every minute. Simplest, no sleep issues. |
| `POWER_BATTERY` | Deep sleep (~14 µA) with a timer wake to the next minute boundary. Wi-Fi only for the 30-min fetch. |

**Rough battery estimate** (to be measured):
- 60 × ~1.5 s partial @ ~40 mA ≈ 1.0 mAh/h
- 2 × ~8 s Wi-Fi @ ~120 mA ≈ 0.5 mAh/h

That is about 1.5 mAh/h, roughly **35–40 mAh/day**, so on the order of **4–7 weeks** in theory. Realistically expect 2–4 weeks. For comparison, one forum user reports **~3 days** with the stock firmware at 20-min refresh, so measurement matters. If it is too short, update the clock every 5 min on battery, or go hourly at night.

**Battery indicator:**
- Convert voltage to % with a LiPo lookup table: 4.20 V = 100, 4.0 = 80, 3.85 = 60, 3.75 = 40, 3.65 = 20, 3.5 = 5, ≤3.4 = 0.
- Average 8 ADC samples.
- No charge pin exists, so when the voltage is above about 4.15 V and rising, show a plug icon ("on USB") instead of %.

### 7.5 Wi-Fi config
Start with `secrets.h` (git-ignored, with `secrets.h.example` committed). Later, optionally, a WiFiManager captive portal triggered by holding a button.

---

## 8. Flashing the reTerminal — first steps

1. **Buy a CR1220 cell** for the RTC backup.
2. You don't need a backup: you can re-flash the stock SenseCraft firmware later from the SenseCraft web tool.
3. Install **VS Code + PlatformIO**. Alternatively, Arduino IDE 2 with ESP32 core 3.x, board *ESP32S3 Dev Module*, **PSRAM: OPI**, USB CDC on boot enabled.
4. Connect USB-C. If no COM port appears, enter download mode (hold BOOT while connecting, per the wiki).
5. Bring-up sketches, one at a time:
   1. Seeed_GxEPD2 hello world: verify the pins (SCK 7, MOSI 9, CS 10, DC 11, RST 12, BUSY 13).
   2. **Partial refresh test:** a counter in a 336×180 window, once per second for 2 minutes. Measure the time per partial refresh and check for ghosting.
   3. The same test with **deep sleep between updates** (see the 7.2 caveat). Decide which option to use.
   4. SHT4x (0x44) and PCF8563 (0x51) read/write.
   5. Battery ADC read (GPIO1/GPIO21).
   6. HTTPS download of `dashboard.bin` from Pages, then a full refresh.
6. Integrate into `firmware/src/main.cpp`.

---

## 9. Milestones

| # | Milestone | Done when |
|---|---|---|
| M1 | Repo + Pages + workflow skeleton | A placeholder `dashboard.png/.bin` is live on Pages and refreshed by cron |
| M2 | Data layer | `data.json` contains METAR LZIB (RH, km/h) + 8 h + 3 days. Model IDs verified. Fixtures recorded. |
| M3 | Layout | The HTML/CSS template is final. The 1-bit render looks good in the preview with simulated holes. |
| M4 | Device bring-up | Display, partial-refresh test (incl. after deep sleep), SHT4x, RTC, battery all work |
| M5 | Device integration | Background download + minute clock + battery run for 24 h on USB |
| M6 | Battery run | Battery mode measured for 3–7 days. Interval decision made. |
| M7 | Polish | Ghosting tuned, stale-data marker, keep-alive, attribution |
| Later | Options | Buttons (second page / forced refresh), WiFiManager, external cron trigger |

---

## 10. Open points

All earlier questions are resolved (see "Decisions so far"). See README.md for how to run and test.
