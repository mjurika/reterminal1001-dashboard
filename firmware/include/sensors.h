#pragma once
// Minimal drivers for the onboard I2C chips (no extra libraries needed):
//   SHT4x temperature/humidity @ 0x44, PCF8563 RTC @ 0x51 (keeps UTC).
#include <Arduino.h>
#include <Wire.h>
#include <time.h>

// ---------- SHT4x ----------

static uint8_t sht4xCrc(const uint8_t *data) {
  uint8_t crc = 0xFF;
  for (int i = 0; i < 2; i++) {
    crc ^= data[i];
    for (int b = 0; b < 8; b++) crc = (crc & 0x80) ? (crc << 1) ^ 0x31 : crc << 1;
  }
  return crc;
}

/** High-precision measurement. Returns false on I2C or CRC error. */
inline bool sht4xRead(float &tempC, float &rh) {
  Wire.beginTransmission(0x44);
  Wire.write(0xFD);
  if (Wire.endTransmission() != 0) return false;
  delay(10);
  uint8_t d[6];
  if (Wire.requestFrom(0x44, 6) != 6) return false;
  for (auto &b : d) b = Wire.read();
  if (sht4xCrc(d) != d[2] || sht4xCrc(d + 3) != d[5]) return false;
  tempC = -45.0f + 175.0f * ((d[0] << 8) | d[1]) / 65535.0f;
  rh = constrain(-6.0f + 125.0f * ((d[3] << 8) | d[4]) / 65535.0f, 0.0f, 100.0f);
  return true;
}

// ---------- PCF8563 ----------

static uint8_t bcd2bin(uint8_t v) { return (v & 0x0F) + 10 * (v >> 4); }
static uint8_t bin2bcd(uint8_t v) { return ((v / 10) << 4) | (v % 10); }

/** Days since 1970-01-01 for a civil date (H. Hinnant's algorithm), timezone independent. */
static int64_t daysFromCivil(int y, unsigned m, unsigned d) {
  y -= m <= 2;
  const int era = (y >= 0 ? y : y - 399) / 400;
  const unsigned yoe = (unsigned)(y - era * 400);
  const unsigned doy = (153 * (m + (m > 2 ? -3 : 9)) + 2) / 5 + d - 1;
  const unsigned doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
  return (int64_t)era * 146097 + (int64_t)doe - 719468;
}

/** Reads UTC epoch from the RTC. Returns false if the chip is missing or the time is invalid (VL flag). */
inline bool rtcRead(time_t &epoch) {
  Wire.beginTransmission(0x51);
  Wire.write(0x02);
  if (Wire.endTransmission() != 0) return false;
  if (Wire.requestFrom(0x51, 7) != 7) return false;
  uint8_t r[7];
  for (auto &b : r) b = Wire.read();
  if (r[0] & 0x80) return false;  // VL: oscillator stopped / backup battery low → time unreliable
  const int sec = bcd2bin(r[0] & 0x7F), min = bcd2bin(r[1] & 0x7F), hour = bcd2bin(r[2] & 0x3F);
  const int day = bcd2bin(r[3] & 0x3F), month = bcd2bin(r[5] & 0x1F), year = 2000 + bcd2bin(r[6]);
  if (year < 2025 || month < 1 || month > 12 || day < 1) return false;
  epoch = (time_t)(daysFromCivil(year, month, day) * 86400 + hour * 3600 + min * 60 + sec);
  return true;
}

inline bool rtcWrite(time_t epoch) {
  struct tm t;
  gmtime_r(&epoch, &t);
  Wire.beginTransmission(0x51);
  Wire.write(0x02);
  Wire.write(bin2bcd(t.tm_sec));  // also clears VL
  Wire.write(bin2bcd(t.tm_min));
  Wire.write(bin2bcd(t.tm_hour));
  Wire.write(bin2bcd(t.tm_mday));
  Wire.write(t.tm_wday);
  Wire.write(bin2bcd(t.tm_mon + 1));
  Wire.write(bin2bcd(t.tm_year % 100));
  return Wire.endTransmission() == 0;
}

/** Starts the RTC oscillator, disables CLKOUT/alarms. */
inline void rtcInit() {
  Wire.beginTransmission(0x51);
  Wire.write(0x00);
  Wire.write(0x00);  // control 1: normal mode, clock running
  Wire.write(0x00);  // control 2: no interrupts
  Wire.endTransmission();
  Wire.beginTransmission(0x51);
  Wire.write(0x0D);
  Wire.write(0x00);  // CLKOUT off (saves power)
  Wire.endTransmission();
}

// ---------- battery ----------

/** Battery voltage via the ×2 divider on GPIO1, enabled by GPIO21 (Seeed wiki). */
inline float batteryVoltage(int adcPin, int enPin) {
  pinMode(enPin, OUTPUT);
  digitalWrite(enPin, HIGH);
  delay(5);
  analogReadResolution(12);
  analogSetPinAttenuation(adcPin, ADC_11db);
  uint32_t mv = 0;
  for (int i = 0; i < 8; i++) mv += analogReadMilliVolts(adcPin);
  digitalWrite(enPin, LOW);
  return mv / 8 / 1000.0f * 2.0f;
}

/** Single-cell LiPo voltage → percent (rough resting-voltage curve). */
inline int batteryPercent(float v) {
  static const float V[] = {3.40f, 3.50f, 3.65f, 3.75f, 3.85f, 4.00f, 4.20f};
  static const int P[] = {0, 5, 20, 40, 60, 80, 100};
  if (v <= V[0]) return 0;
  for (int i = 1; i < 7; i++) {
    if (v <= V[i]) return P[i - 1] + (int)((v - V[i - 1]) / (V[i] - V[i - 1]) * (P[i] - P[i - 1]));
  }
  return 100;
}
