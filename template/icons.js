// Monochrome weather icons (64×64 viewBox, black strokes on white) for 1-bit e-paper rendering.

const S = 'fill="none" stroke="#000" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"';
const CLOUD = 'M16 44 H48 A9 9 0 0 0 48 26 A13 13 0 0 0 23 22 A11 11 0 0 0 16 44 Z';

const sun = (cx, cy, r) => {
  const rays = Array.from({ length: 8 }, (_, i) => {
    const a = (i * Math.PI) / 4;
    const p = (d) => `${(cx + Math.cos(a) * d).toFixed(1)} ${(cy + Math.sin(a) * d).toFixed(1)}`;
    return `M${p(r + 4)} L${p(r + 9)}`;
  }).join(' ');
  return `<circle cx="${cx}" cy="${cy}" r="${r}" ${S}/><path d="${rays}" ${S}/>`;
};

const moon = (cx, cy, r) =>
  `<path d="M${cx + r * 0.3} ${cy - r} A${r} ${r} 0 1 0 ${cx + r} ${cy + r * 0.45} A${r * 0.8} ${r * 0.8} 0 0 1 ${cx + r * 0.3} ${cy - r} Z" ${S}/>`;

const cloud = (dy = 0, fill = '#fff') => `<path d="${CLOUD}" transform="translate(0 ${dy})" fill="${fill}" stroke="#000" stroke-width="3.5" stroke-linejoin="round"/>`;
const backCloud = () => `<path d="${CLOUD}" transform="translate(20 -6) scale(0.7)" fill="#fff" stroke="#000" stroke-width="5" stroke-linejoin="round"/>`;
const sky = (isDay) => (isDay ? sun(22, 20, 8) : moon(20, 18, 10));

const rain = (n) => {
  const xs = n === 2 ? [26, 38] : [22, 32, 42];
  return `<path d="${xs.map((x) => `M${x} 44 L${x - 4} 56`).join(' ')}" ${S}/>`;
};
const drizzle = () => [24, 34, 44].map((x, i) => `<circle cx="${x - (i % 2) * 2}" cy="${50 + (i % 2) * 6}" r="2.2" fill="#000"/>`).join('');
const flake = (x, y) => `<path d="M${x - 4} ${y} H${x + 4} M${x - 2} ${y - 3.5} L${x + 2} ${y + 3.5} M${x + 2} ${y - 3.5} L${x - 2} ${y + 3.5}" fill="none" stroke="#000" stroke-width="2.5" stroke-linecap="round"/>`;
const snow = () => flake(24, 50) + flake(40, 50) + flake(32, 58);
const sleet = () => `<path d="M26 44 L22 56" ${S}/>` + flake(38, 52);
const bolt = () => '<path d="M34 40 L26 52 H32 L28 62 L40 48 H34 L38 40 Z" fill="#000"/>';
const fog = () => `<path d="M14 34 H50 M10 42 H46 M18 50 H54" ${S}/>` + `<path d="M20 26 H44" ${S}/>`;

/** WMO weather code → icon key */
export function iconKey(code) {
  if (code === null || code === undefined) return 'unknown';
  if (code === 0) return 'clear';
  if (code === 1) return 'mostly-clear';
  if (code === 2) return 'partly-cloudy';
  if (code === 3) return 'overcast';
  if (code === 45 || code === 48) return 'fog';
  if (code >= 51 && code <= 55) return 'drizzle';
  if (code === 56 || code === 57 || code === 66 || code === 67) return 'sleet';
  if (code === 61 || code === 80) return 'rain-light';
  if (code >= 61 && code <= 65) return 'rain';
  if (code === 81 || code === 82) return 'rain';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if (code >= 95) return 'thunder';
  return 'unknown';
}

const BODIES = {
  clear: (d) => (d ? sun(32, 32, 11) : moon(30, 30, 16)),
  'mostly-clear': (d) => sky(d) + `<path d="M30 46 H50 A7 7 0 0 0 50 32 A9 9 0 0 0 34 31 A8 8 0 0 0 30 46 Z" fill="#fff" ${S}/>`,
  'partly-cloudy': (d) => sky(d) + cloud(4),
  overcast: () => backCloud() + cloud(6),
  fog: () => fog(),
  drizzle: () => cloud(-6) + drizzle(),
  'rain-light': () => cloud(-6) + rain(2),
  rain: () => cloud(-6) + rain(3),
  sleet: () => cloud(-6) + sleet(),
  snow: () => cloud(-6) + snow(),
  thunder: () => cloud(-8) + bolt(),
  unknown: () => `<text x="32" y="44" font-size="32" text-anchor="middle" font-family="sans-serif">?</text>`,
};

export function weatherIcon(code, isDay = true, size = 56) {
  const body = BODIES[iconKey(code)](isDay);
  return `<svg class="wx" width="${size}" height="${size}" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;
}

/** Small raindrop used next to precipitation probability. */
export const dropIcon = (size = 16) =>
  `<svg class="drop" width="${size}" height="${size}" viewBox="0 0 16 16"><path d="M8 1 C8 1 2.5 8 2.5 10.5 A5.5 5.5 0 0 0 13.5 10.5 C13.5 8 8 1 8 1 Z" fill="#000"/></svg>`;
