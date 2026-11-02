const USER_AGENT = 'reterminal-dashboard (github.com; weather e-paper display)';

export interface Metar {
  station: string;
  obsTime: string; // ISO UTC
  tempC: number;
  dewC: number;
  rh: number;
  windDirDeg: number | null; // null = variable
  windKmh: number;
  gustKmh: number | null;
  raw: string;
}

/** Relative humidity [%] from temperature and dew point [°C] (Magnus formula). */
export function relativeHumidity(tempC: number, dewC: number): number {
  const e = (t: number) => Math.exp((17.625 * t) / (243.04 + t));
  return Math.max(0, Math.min(100, Math.round((100 * e(dewC)) / e(tempC))));
}

export const ktToKmh = (kt: number) => Math.round(kt * 1.852);

/** Beaufort scale: lower bound in km/h of degrees 1–12 and Slovak names (sk.wikipedia.org/wiki/Beaufortova_stupnica_sily_vetra). */
const BEAUFORT_KMH = [1, 6, 12, 20, 29, 39, 50, 62, 75, 89, 103, 118];
const BEAUFORT_SK = [
  'bezvetrie', 'vánok', 'slabý vietor', 'mierny vietor', 'dosť čerstvý vietor', 'čerstvý vietor', 'silný vietor',
  'prudký vietor', 'búrlivý vietor', 'víchrica', 'silná víchrica', 'mohutná víchrica', 'orkán',
];

export function beaufort(kmh: number): { degree: number; name: string } {
  const degree = BEAUFORT_KMH.filter((b) => kmh >= b).length;
  return { degree, name: BEAUFORT_SK[degree] };
}

const DIRS_SK = ['S', 'SV', 'V', 'JV', 'J', 'JZ', 'Z', 'SZ'];

/** Wind direction in degrees → Slovak 8-point compass (S = sever, J = juh, V = východ, Z = západ). */
export function windDirSk(deg: number | null): string {
  if (deg === null) return 'premenlivý';
  return DIRS_SK[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}

/** Parses the bits we need from a raw METAR string (fallback source). */
export function parseRawMetar(raw: string, now = new Date()): Metar {
  const station = raw.match(/\b([A-Z]{4})\s+\d{6}Z/)?.[1];
  const time = raw.match(/\b(\d{2})(\d{2})(\d{2})Z\b/);
  const wind = raw.match(/\b(\d{3}|VRB)(\d{2,3})(?:G(\d{2,3}))?KT\b/);
  const temp = raw.match(/\s(M?\d{2})\/(M?\d{2})\s/);
  if (!station || !time || !wind || !temp) throw new Error(`Cannot parse METAR: ${raw}`);

  const num = (s: string) => (s.startsWith('M') ? -Number(s.slice(1)) : Number(s));
  const obs = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), Number(time[1]), Number(time[2]), Number(time[3])));
  if (obs.getTime() - now.getTime() > 86_400_000) obs.setUTCMonth(obs.getUTCMonth() - 1); // report from previous month
  const tempC = num(temp[1]);
  const dewC = num(temp[2]);
  return {
    station,
    obsTime: obs.toISOString(),
    tempC,
    dewC,
    rh: relativeHumidity(tempC, dewC),
    windDirDeg: wind[1] === 'VRB' ? null : Number(wind[1]),
    windKmh: ktToKmh(Number(wind[2])),
    gustKmh: wind[3] ? ktToKmh(Number(wind[3])) : null,
    raw: raw.trim(),
  };
}

/** Converts an aviationweather.gov JSON record into our format. */
export function fromAwcJson(rec: any): Metar {
  const windDirDeg = typeof rec.wdir === 'number' ? rec.wdir : null; // "VRB" is a string
  return {
    station: rec.icaoId,
    obsTime: new Date(rec.obsTime * 1000).toISOString(),
    tempC: rec.temp,
    dewC: rec.dewp,
    rh: relativeHumidity(rec.temp, rec.dewp),
    windDirDeg,
    windKmh: ktToKmh(rec.wspd ?? 0),
    gustKmh: rec.wgst ? ktToKmh(rec.wgst) : null,
    raw: rec.rawOb,
  };
}

export async function fetchMetarRaw(station: string): Promise<{ source: string; body: string }> {
  const headers = { 'User-Agent': USER_AGENT };
  try {
    const res = await fetch(`https://aviationweather.gov/api/data/metar?ids=${station}&format=json`, { headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.text();
    if (!JSON.parse(body).length) throw new Error('empty response');
    return { source: 'awc-json', body };
  } catch (err) {
    console.warn(`AWC JSON failed (${(err as Error).message}), trying NOAA TXT`);
    const res = await fetch(`https://tgftp.nws.noaa.gov/data/observations/metar/stations/${station}.TXT`, { headers });
    if (!res.ok) throw new Error(`NOAA TXT HTTP ${res.status}`);
    return { source: 'noaa-txt', body: await res.text() };
  }
}

export function parseMetarResponse(source: string, body: string, now = new Date()): Metar {
  if (source === 'awc-json') return fromAwcJson(JSON.parse(body)[0]);
  // NOAA TXT: first line is a timestamp, second line the METAR
  return parseRawMetar(body.trim().split('\n').pop()!, now);
}
