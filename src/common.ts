import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const OUT = join(ROOT, 'out');
export const SITE = join(ROOT, 'site');
export const FIXTURES = join(ROOT, 'fixtures');
export const FONTS = join(ROOT, 'node_modules', '@fontsource', 'barlow-condensed', 'files');

export interface Config {
  station: string;
  stationName: string;
  latitude: number;
  longitude: number;
  timezone: string;
  hourlyModels: string[];
  dailyModels: string[];
  hours: number;
  days: number;
  metarStaleMinutes: number;
  threshold: number;
}

export interface Rect { x: number; y: number; w: number; h: number }

export interface Layout {
  width: number;
  height: number;
  holes: Record<string, Rect>;
}

export const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;
export const loadConfig = () => readJson<Config>(join(ROOT, 'config.json'));

/** Loads layout.json and checks that every hole is usable as a UC8179 partial window. */
export function loadLayout(): Layout {
  const layout = readJson<Layout>(join(ROOT, 'layout.json'));
  for (const [name, r] of Object.entries(layout.holes)) {
    if (r.x % 8 !== 0 || r.w % 8 !== 0) {
      throw new Error(`layout.json: hole "${name}" x and w must be multiples of 8 (got x=${r.x}, w=${r.w})`);
    }
    if (r.x + r.w > layout.width || r.y + r.h > layout.height) {
      throw new Error(`layout.json: hole "${name}" is outside the ${layout.width}x${layout.height} screen`);
    }
  }
  return layout;
}

/** Local wall-clock parts of `date` in `timeZone`. */
export function localParts(date: Date, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(date).map((p) => [p.type, p.value]),
  );
  return {
    year: parts.year, month: parts.month, day: parts.day, hour: parts.hour, minute: parts.minute,
    /** Same format as Open-Meteo local times, e.g. "2026-11-01T14:35". */
    iso: `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`,
    date: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

export const WEEKDAYS_SK = ['Nedeľa', 'Pondelok', 'Utorok', 'Streda', 'Štvrtok', 'Piatok', 'Sobota'];
export const WEEKDAYS_SK_SHORT = ['Ne', 'Po', 'Ut', 'St', 'Št', 'Pi', 'So'];

/** Weekday index (0 = Sunday) of a "YYYY-MM-DD" calendar date. */
export const weekdayOf = (ymd: string) => new Date(`${ymd}T12:00:00Z`).getUTCDay();

/** "YYYY-MM-DD" → "DD.MM" */
export const ddmm = (ymd: string) => `${ymd.slice(8, 10)}.${ymd.slice(5, 7)}`;
