# reTerminal E1001 weather dashboard

An 800×480 black-and-white e-paper dashboard for the Seeed **reTerminal E1001**:

- **Background** (date, METAR LZIB, 8-hour forecast, 3-day forecast) is rendered from an HTML/CSS template by **GitHub Actions** every 30 min and published on **GitHub Pages**.
- **Clock (HH:mm), indoor temperature/humidity and battery level** are drawn by the device itself, with a **partial refresh** every minute.

```
GitHub Actions (cron :01/:31)                                     reTerminal E1001
  METAR LZIB ─┐                                                    ┌──────────────────────────────┐
  Open-Meteo ─┼─► data.json ─► HTML/CSS ─► Chromium ─► 1-bit ─►    │ every 30 min: dashboard.bin  │
              │   (Node/TS)    template    screenshot  .bin/.png   │   → full refresh             │
              └──────────────────── GitHub Pages ◄──────────────── │ every minute: RTC + SHT4x    │
                                                                   │   → partial refresh          │
                                                                   └──────────────────────────────┘
```

See [PLAN.md](PLAN.md) for the design decisions, hardware facts and data-source notes.

---

## Repository layout

| Path | What |
|---|---|
| `template/` | **The layout**: `dashboard.html`, `dashboard.css`, `dashboard.js`, `icons.js` (B/W SVG weather icons) |
| `layout.json` | Device-drawn "holes" (clock, indoor, battery). Shared by the template, the preview and the firmware. |
| `config.json` | Station, coordinates, models, threshold |
| `src/` | Node/TypeScript: data fetch, render, 1-bit conversion, site build, firmware header generator, dev server |
| `preview/index.html` | Preview page (served as the Pages index) |
| `fixtures/` | Recorded API responses (`live/`) and a synthetic `showcase/` (rain, snow, storm, gusts) |
| `test/` | Unit tests (`node:test`) |
| `.github/workflows/` | `render.yml` (cron → Pages), `ci.yml` (tests + fixture render), `keepalive.yml` |
| `firmware/` | PlatformIO project for the reTerminal |

---

## 1. Run the web part locally

Requirements: **Node.js 22+**, git.

```bash
npm install
npx playwright install chromium     # once, headless browser used for rendering

npm run build:fixtures              # offline: showcase fixture → out/dashboard.png/.bin → site/
npm run build                       # live data:  METAR + Open-Meteo → out/ → site/
npm run dev                         # http://127.0.0.1:5173/
```

`npm run dev` prints these URLs:

| URL | Use |
|---|---|
| `http://127.0.0.1:5173/` | Preview page: the rendered PNG in a device frame with a simulated clock, indoor values and battery (live clock, editable values) |
| `/template/dashboard.html?holes=demo` | The live HTML template. **Use this while editing the CSS** (reload after changes). |
| `/template/dashboard.html?holes=demo&bw=1` | Same, with the 1-bit threshold preview |
| `/template/dashboard.html?holes=outline` | Shows where the device-drawn holes are |

The template reads `out/data.json`. Run `npm run fetch` (live) or `npm run fetch:fixtures` (showcase) first.

### All scripts

| Script | What it does |
|---|---|
| `npm run fetch` | Live METAR + forecast → `out/data.json` |
| `npm run fetch:fixtures` | `fixtures/showcase` → `out/data.json`. Use `npx tsx src/build-data.ts --fixtures=live` for the recorded live data. |
| `npm run fixtures:record` | Saves current API responses to `fixtures/live/`. Use `npx tsx src/record-fixtures.ts <name>` for another folder. |
| `npm run render` | `out/data.json` → `out/dashboard.png` (1-bit), `out/dashboard.bin` (48 000 B), `out/meta.json`, `out/raw.png` (anti-aliased original) |
| `npm run site` | Assembles `site/` for GitHub Pages |
| `npm run build` / `build:fixtures` | fetch + render + site |
| `npm test` | Unit tests (RH formula, wind, METAR parser, time zone, forecast selection, bit packing, layout alignment) |
| `npm run typecheck` | TypeScript check |
| `npm run gen:firmware` | Regenerates `firmware/include/layout.h` and `fonts.h` (see §4) |

### Editing the layout

- Work in `template/dashboard.css` / `dashboard.js` with `?holes=demo` open. The page is a fixed **800×480** canvas.
- **Use only pure black and white.** Thin (<2 px) lines and grey disappear or break up after thresholding (`config.json → threshold`, default 160). Check with `&bw=1`.
- Weather icons are plain SVG in `template/icons.js` (WMO code → icon).
- **Moving or resizing a device hole:** edit `layout.json`. **x and w must be multiples of 8** (partial-refresh windows are byte-aligned; the build fails otherwise). Then run `npm run gen:firmware` and re-flash the device.
- Texts are Slovak. Numbers use a decimal comma.

### Data

| What | Source |
|---|---|
| Current conditions | `aviationweather.gov` METAR **LZIB** (JSON), fallback NOAA TXT. RH is computed from T/Td (Magnus). Wind is converted kt → km/h with Slovak compass points. Struck through when older than 90 min. |
| Next 8 h | Open-Meteo `chmi_aladin_central_europe_2km` (temperature, 1h precipitation, weather code). Missing values, incl. precipitation probability, fall back to `ecmwf_ifs`. |
| Next 3 days (from tomorrow) | Open-Meteo `ecmwf_ifs`: min/max, weather code, max precipitation probability, precipitation sum |

The models and coordinates are set in `config.json`. Open-Meteo is free for non-commercial use, and attribution is in the footer.

---

## 2. Publish on GitHub (testable without the device)

1. Create a **public** repository, e.g. `reterminal-dashboard`. Public repos get free Actions minutes and Pages.
2. Push this folder:
   ```bash
   git init -b main
   git add .
   git commit -m "Initial dashboard"
   git remote add origin https://github.com/<user>/reterminal-dashboard.git
   git push -u origin main
   ```
3. **Settings → Pages → Build and deployment → Source: GitHub Actions**.
4. **Actions → render → Run workflow** (the push to `main` also triggers it).
5. Open `https://<user>.github.io/reterminal-dashboard/`. This is the preview page with the live 1-bit image and the simulated clock. The device downloads `…/dashboard.bin` and `…/meta.json`.

After that, `render.yml` is scheduled at **:01 and :31** every hour. GitHub cron is best-effort, so runs often start 5–20 min late.

How the METAR delay is kept short:
- **Workflow:** `npm run fetch -- --wait-metar=10`. If the run starts before the METAR of the current half hour is on aviationweather.gov, it polls every 30 s for up to 10 minutes. It never publishes the old observation when a new one is due.
- **Build:** the job runs in the official Playwright container (`mcr.microsoft.com/playwright:v1.64.1-noble`), which has Chromium preinstalled, so the whole run takes about 1–1.5 min. The tag must match the `playwright` version in `package.json`; `npm test` checks this. When upgrading Playwright, update the tag in `render.yml` and `ci.yml`.
- **Device:** polls `meta.json` every 2 minutes from :04 to :24 (and :34 to :54) until its `metarTime` matches the current half hour (see §3).

- `ci.yml` runs on pull requests and non-main branches. It typechecks, tests, renders the showcase fixture and attaches `dashboard.png` as an artifact.
- `keepalive.yml` re-enables the scheduled workflows monthly. GitHub disables them after 60 days without repo activity.
- If you want punctual runs, add an external trigger (e.g. cron-job.org) that calls `POST /repos/mjurika/reterminal1001-dashboard/actions/workflows/render.yml/dispatches` with body `{"ref":"main"}`. Use a fine-grained token with *Actions: write*.

---

## 3. Flash the reTerminal

### Prerequisites
- **PlatformIO**: either the VS Code extension, or the CLI (`pip install platformio`).
- A **CR1220 coin cell** in the RTC holder. It isn't included, and without it the time is lost when the battery runs flat. NTP fixes the time at the next Wi-Fi connection.
- The USB-C cable.

### Configure
```bash
cd firmware
cp include/secrets.h.example include/secrets.h      # Wi-Fi SSID + password (git-ignored)
```
Edit `include/config.h`:
- `DASHBOARD_BASE_URL`: `https://<user>.github.io/reterminal-dashboard`
- Optional: `INDOOR_TEMP_OFFSET` (case self-heating correction), fetch minutes, night hours.

### Build and flash

```bash
pio run -e usb -t upload            # pick one environment, see below
pio device monitor                  # log output at 115200 baud
```

| Environment | Power | Behaviour |
|---|---|---|
| `usb` | USB | Always awake. Clock every minute, day and night. |
| `battery` | Battery | **Light sleep** between minutes. Clock paused **23:00–06:00** (shows `--:--`). Display controller stays powered, so partial refreshes are clean. |
| `battery_deep` | Battery | **Deep sleep** (~14 µA) between minutes, also with the night pause. Lowest consumption. Partial refresh after deep sleep is **experimental**, see below. |

If the upload doesn't start, hold the **BOOT** button while plugging in USB, or follow Seeed's download-mode instructions. The stock SenseCraft firmware can be restored later with the SenseCraft web flasher.

The logs go to `Serial1` (GPIO43/44), as in Seeed's examples. If `pio device monitor` stays silent, try the other COM port, or change `Log` in `main.cpp` to `Serial`.

### What the device does
- **Cold boot:** Wi-Fi → NTP → PCF8563 RTC, downloads `meta.json` + `dashboard.bin`, then does a full refresh.
- **Every minute:** time from the RTC, reads the SHT4x, then a **partial refresh** of the clock + indoor area (`layout.json` holes).
- **New METAR:** from HH:04 / HH:34 it checks `meta.json` (a few hundred bytes) every 2 minutes, until `metarTime` shows the current half hour's observation, at the latest until :24 / :54. When the hash changes, it downloads the 48 kB bitmap (cached in LittleFS) and does a full refresh. Then it stops checking until the next half hour. Expect the new METAR on screen about 1–2 minutes after GitHub publishes it.
- Besides that it checks at least every 30 minutes. After a failed download it retries every 5 minutes. If the last successful check is older than 2 h, a `!` appears next to the battery.
- The intervals are set in `firmware/include/config.h` (`METAR_POLL_*`, `FETCH_*`).
- A full refresh is also forced after 60 partial refreshes, to clear ghosting.
- **Battery:** read every 10 min. Above 4.15 V it shows `USB`, since there is no charge-detect pin.

### Deep sleep and partial refresh
Partial refresh on the UC8179 compares the new image with the previous one in the controller's RAM. In `battery_deep`, the firmware keeps that RAM alive:
- the display is only `powerOff()`-ed, not hibernated,
- the RST/CS pins are held high during sleep,
- and the driver is given no reset pin, so `init()` does not reset the controller after waking.

If you see artifacts in the clock area after wake-ups, use the `battery` environment instead.

---

## 4. Device fonts and layout headers

`firmware/include/layout.h` and `fonts.h` are **generated**. Don't edit them by hand:

```bash
npm run gen:firmware
```

This rasterizes **Barlow Condensed** (the template font) in Chromium into Adafruit-GFX fonts:
- clock 144 px
- medium 40 px
- small 22 px

So device-drawn text matches the background. Re-run it after changing `layout.json` or the font sizes in `src/gen-firmware.ts`, then re-flash. The device fonts are ASCII only: the degree sign is drawn as a circle, and device text needs no diacritics.

---

## 5. Testing checklist

| Level | How |
|---|---|
| Unit tests | `npm test` |
| Layout, offline | `npm run build:fixtures && npm run dev` → check the preview page and `?bw=1` |
| Layout, live data | `npm run build && npm run dev` |
| CI | Open a PR and download the `dashboard-preview` artifact |
| Online | `https://<user>.github.io/reterminal-dashboard/` |
| Device bring-up | Flash `usb`, watch the serial log, check the full refresh and the minute partial refresh |
| Battery | Flash `battery`, run for a few days, watch the % (then try `battery_deep`) |

## Credits
- Weather data: [Open-Meteo](https://open-meteo.com) (CC BY 4.0), with CHMI ALADIN and ECMWF IFS models
- METAR: NOAA [Aviation Weather Center](https://aviationweather.gov)
- Font: Barlow Condensed (SIL OFL 1.1)
- Display driver: [GxEPD2](https://github.com/ZinggJM/GxEPD2)
