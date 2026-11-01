/**
 * Fetches METAR + forecast (or reads fixtures) and writes out/data.json for the template.
 *
 *   npm run fetch                      live data
 *   npm run fetch -- --wait-metar=10   live data, first wait up to 10 min for the METAR of the current half hour
 *   npm run fetch:fixtures             fixtures/showcase
 *   tsx src/build-data.ts --fixtures=live
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  FIXTURES, OUT, WEEKDAYS_SK, WEEKDAYS_SK_SHORT, ddmm, loadConfig, localParts, readJson, weekdayOf,
} from './common.ts';
import { fetchMetarRaw, parseMetarResponse, windDirSk, type Metar } from './fetch/metar.ts';
import { fetchForecastRaw, parseForecast } from './fetch/forecast.ts';

const MODEL_NAMES: Record<string, string> = {
  chmi_aladin_central_europe_2km: 'ALADIN CE 2 km',
  chmi_aladin_seamless: 'ALADIN',
  ecmwf_ifs: 'ECMWF IFS',
  ecmwf_ifs025: 'ECMWF IFS 0,25°',
};

export interface RawInputs {
  now: Date;
  metar: { source: string; body: string } | null;
  forecast: string;
}

/** Start of the current half hour (UTC), i.e. the observation time of the newest regular METAR. */
export const currentMetarSlot = (now: Date) => new Date(Math.floor(now.getTime() / 1_800_000) * 1_800_000);

/**
 * Fetches the METAR; with waitMinutes > 0 polls until the report for the current half hour is available,
 * so a run started at :01 doesn't publish the previous observation.
 */
async function fetchMetarWaiting(station: string, waitMinutes: number) {
  const deadline = Date.now() + waitMinutes * 60_000;
  for (;;) {
    const metar = await fetchMetarRaw(station).catch((err) => {
      console.error(`METAR unavailable: ${err.message}`);
      return null;
    });
    const slot = currentMetarSlot(new Date());
    let obs: Date | null = null;
    try {
      if (metar) obs = new Date(parseMetarResponse(metar.source, metar.body).obsTime);
    } catch (err) {
      console.error((err as Error).message);
    }
    if ((obs && obs >= slot) || Date.now() + 30_000 > deadline) {
      if (waitMinutes > 0) console.log(`METAR ${obs?.toISOString() ?? 'n/a'} (slot ${slot.toISOString()})`);
      return metar;
    }
    console.log(`Waiting for METAR ${slot.toISOString()} (latest ${obs?.toISOString() ?? 'n/a'})…`);
    await new Promise((r) => setTimeout(r, 30_000));
  }
}

export async function fetchInputs(waitMetarMinutes = 0): Promise<RawInputs> {
  const cfg = loadConfig();
  const metar = await fetchMetarWaiting(cfg.station, waitMetarMinutes);
  const forecast = await fetchForecastRaw(cfg);
  return { now: new Date(), metar, forecast };
}

export function readFixtureInputs(name: string): RawInputs {
  const dir = join(FIXTURES, name);
  const metar = readJson<{ source: string; body: string; capturedAt: string }>(join(dir, 'metar.json'));
  const forecast = readJson<{ body: string; capturedAt: string }>(join(dir, 'forecast.json'));
  return { now: new Date(forecast.capturedAt), metar, forecast: forecast.body };
}

export function buildData(inputs: RawInputs) {
  const cfg = loadConfig();
  const now = localParts(inputs.now, cfg.timezone);

  let metar: (Metar & Record<string, unknown>) | null = null;
  if (inputs.metar) {
    const m = parseMetarResponse(inputs.metar.source, inputs.metar.body, inputs.now);
    const ageMin = Math.round((inputs.now.getTime() - new Date(m.obsTime).getTime()) / 60_000);
    metar = {
      ...m,
      obsTimeLocal: localParts(new Date(m.obsTime), cfg.timezone).iso.slice(11, 16),
      ageMin,
      stale: ageMin > cfg.metarStaleMinutes,
      windDir: windDirSk(m.windDirDeg),
    };
  }

  const { hours, days } = parseForecast(inputs.forecast, cfg, now.iso);
  const usedModels = [...new Set(hours.map((h) => h.model).filter(Boolean))] as string[];

  return {
    generatedAt: inputs.now.toISOString(),
    local: {
      time: `${now.hour}:${now.minute}`,
      date: ddmm(now.date),
      weekday: WEEKDAYS_SK[weekdayOf(now.date)],
    },
    station: { id: cfg.station, name: cfg.stationName },
    metar,
    hours: hours.map((h) => ({ ...h, label: h.time.slice(11, 16) })),
    days: days.map((d) => ({ ...d, label: ddmm(d.date), weekday: WEEKDAYS_SK_SHORT[weekdayOf(d.date)] })),
    models: {
      hourly: usedModels.map((m) => MODEL_NAMES[m] ?? m),
      daily: cfg.dailyModels.map((m) => MODEL_NAMES[m] ?? m),
    },
  };
}

export type DashboardData = ReturnType<typeof buildData>;

async function main() {
  const arg = process.argv.find((a) => a.startsWith('--fixtures'));
  const wait = Number(process.argv.find((a) => a.startsWith('--wait-metar='))?.split('=')[1] ?? 0);
  const inputs = arg ? readFixtureInputs(arg.split('=')[1] ?? 'showcase') : await fetchInputs(wait);
  const data = buildData(inputs);
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, 'data.json'), JSON.stringify(data, null, 2));
  console.log(`out/data.json written (${arg ? 'fixtures' : 'live'}; METAR ${data.metar ? data.metar.obsTimeLocal : 'n/a'}, ${data.hours.length} h, ${data.days.length} days)`);
}

if (process.argv[1]?.endsWith('build-data.ts')) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
