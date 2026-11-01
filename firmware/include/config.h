#pragma once

// ---------- what to download ----------
// GitHub Pages URL of the rendered dashboard, without trailing slash.
#define DASHBOARD_BASE_URL "https://mjurika.github.io/reterminal1001-dashboard"

// ---------- time ----------
#define TZ_INFO     "CET-1CEST,M3.5.0,M10.5.0/3"  // Europe/Bratislava
#define NTP_SERVER1 "sk.pool.ntp.org"
#define NTP_SERVER2 "pool.ntp.org"

// ---------- schedule ----------
#define FETCH_MINUTE_A 8            // background download at HH:08 and HH:38
#define FETCH_MINUTE_B 38           //   (GitHub job runs at :05/:35 and takes ~2 min)
#define FETCH_RETRY_MINUTES 5       // retry interval while the background is older than 35 min
#define FULL_REFRESH_EVERY 60       // force a full refresh after this many partial refreshes (ghosting)
#define BATTERY_UPDATE_MINUTES 10   // battery indicator refresh interval
#define NIGHT_START_HOUR 23         // battery modes: no clock updates 23:00–06:00
#define NIGHT_END_HOUR 6

// ---------- calibration ----------
#define INDOOR_TEMP_OFFSET 0.0f     // °C, added to the SHT4x reading (case self-heating)
#define USB_VOLTAGE_THRESHOLD 4.15f // battery voltage above this is shown as "USB"

// ---------- power modes (selected by platformio.ini env) ----------
#define POWER_USB 0
#define POWER_BATTERY_LIGHT 1
#define POWER_BATTERY_DEEP 2
#ifndef POWER_MODE
#define POWER_MODE POWER_USB
#endif

// ---------- reTerminal E1001 pins (Seeed wiki) ----------
#define EPD_SCK  7
#define EPD_MOSI 9
#define EPD_CS   10
#define EPD_DC   11
#define EPD_RST  12
#define EPD_BUSY 13
#define SD_CS    14   // shares the SPI bus, keep high
#define I2C_SDA  19
#define I2C_SCL  20
#define BATTERY_ADC 1
#define BATTERY_EN  21
#define LED_PIN  6    // active low
#define LOG_RX   44   // Serial1 debug UART (USB-C bridge)
#define LOG_TX   43
