/**
 * Fetches METAR + forecast (or reads fixtures) and writes out/data.json for the template.
 *
 *   npm run fetch                      live data
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

export async function fetchInputs(): Promise<RawInputs> {
  const cfg = loadConfig();
  const [metar, forecast] = await Promise.all([
    fetchMetarRaw(cfg.station).catch((err) => {
      console.error(`METAR unavailable: ${err.message}`);
      return null;
    }),
    fetchForecastRaw(cfg),
  ]);
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
  const inputs = arg ? readFixtureInputs(arg.split('=')[1] ?? 'showcase') : await fetchInputs();
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
