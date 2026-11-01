import type { Config } from '../common.ts';

const HOURLY_VARS = ['temperature_2m', 'precipitation', 'precipitation_probability', 'weather_code', 'is_day'];
const DAILY_VARS = ['temperature_2m_max', 'temperature_2m_min', 'weather_code', 'precipitation_probability_max', 'precipitation_sum'];

export interface HourForecast {
  time: string; // local "YYYY-MM-DDTHH:00"
  tempC: number | null;
  precipMm: number | null;
  precipProb: number | null;
  code: number | null;
  isDay: boolean;
  model: string | null; // model that provided the temperature
}

export interface DayForecast {
  date: string; // local "YYYY-MM-DD"
  tMin: number | null;
  tMax: number | null;
  code: number | null;
  precipProb: number | null;
  precipMm: number | null;
}

const allModels = (cfg: Config) => [...new Set([...cfg.hourlyModels, ...cfg.dailyModels])];

export function forecastUrl(cfg: Config): string {
  const p = new URLSearchParams({
    latitude: String(cfg.latitude),
    longitude: String(cfg.longitude),
    hourly: HOURLY_VARS.join(','),
    daily: DAILY_VARS.join(','),
    timezone: cfg.timezone,
    forecast_days: String(cfg.days + 2),
    models: allModels(cfg).join(','),
  });
  return `https://api.open-meteo.com/v1/forecast?${p}`;
}

export async function fetchForecastRaw(cfg: Config): Promise<string> {
  const res = await fetch(forecastUrl(cfg));
  const body = await res.text();
  if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}: ${body.slice(0, 300)}`);
  return body;
}

/**
 * With several models Open-Meteo suffixes every variable ("temperature_2m_ecmwf_ifs").
 * Returns the first non-null value following the model preference order, plus the model it came from.
 */
function pick(section: Record<string, any[]>, variable: string, i: number, prefer: string[], multi: boolean) {
  for (const model of prefer) {
    const v = section[multi ? `${variable}_${model}` : variable]?.[i];
    if (v !== null && v !== undefined) return { value: v as number, model };
  }
  return { value: null, model: null };
}

/** Next `cfg.hours` full hours after `nowLocalIso` and `cfg.days` days starting tomorrow. */
export function parseForecast(body: string, cfg: Config, nowLocalIso: string) {
  const json = JSON.parse(body);
  if (json.error) throw new Error(`Open-Meteo error: ${json.reason}`);
  const multi = allModels(cfg).length > 1;

  const hourly = json.hourly as Record<string, any[]>;
  const start = (hourly.time as string[]).findIndex((t) => t > nowLocalIso);
  if (start < 0) throw new Error('Forecast does not cover the current time');
  const hours: HourForecast[] = [];
  for (let i = start; i < start + cfg.hours && i < hourly.time.length; i++) {
    const g = (v: string) => pick(hourly, v, i, cfg.hourlyModels, multi);
    const temp = g('temperature_2m');
    hours.push({
      time: hourly.time[i],
      tempC: temp.value,
      precipMm: g('precipitation').value,
      precipProb: g('precipitation_probability').value,
      code: g('weather_code').value,
      isDay: g('is_day').value !== 0,
      model: temp.model,
    });
  }

  const daily = json.daily as Record<string, any[]>;
  const today = nowLocalIso.slice(0, 10);
  const days: DayForecast[] = [];
  (daily.time as string[]).forEach((date, i) => {
    if (date <= today || days.length >= cfg.days) return;
    const g = (v: string) => pick(daily, v, i, cfg.dailyModels, multi).value;
    days.push({
      date,
      tMin: g('temperature_2m_min'),
      tMax: g('temperature_2m_max'),
      code: g('weather_code'),
      precipProb: g('precipitation_probability_max'),
      precipMm: g('precipitation_sum'),
    });
  });

  return { hours, days };
}
