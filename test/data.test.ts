import { test } from 'node:test';
import assert from 'node:assert/strict';
import { relativeHumidity, ktToKmh, windDirSk, parseRawMetar } from '../src/fetch/metar.ts';
import { parseForecast } from '../src/fetch/forecast.ts';
import { buildData, readFixtureInputs } from '../src/build-data.ts';
import { loadConfig, loadLayout, localParts } from '../src/common.ts';
import { packBits, threshold } from '../src/to-1bit.ts';

test('relative humidity from T/Td', () => {
  assert.equal(relativeHumidity(20, 20), 100);
  assert.equal(relativeHumidity(11, 3), 58);
  assert.equal(relativeHumidity(-4, -7), 80);
});

test('wind conversion and Slovak compass', () => {
  assert.equal(ktToKmh(10), 19);
  assert.equal(windDirSk(0), 'S');
  assert.equal(windDirSk(360), 'S');
  assert.equal(windDirSk(225), 'JZ');
  assert.equal(windDirSk(95), 'V');
  assert.equal(windDirSk(null), 'premenlivý');
});

test('raw METAR parser', () => {
  const m = parseRawMetar('LZIB 011030Z VRB03G15KT 9999 M02/M05 Q1020', new Date('2026-11-01T11:00:00Z'));
  assert.equal(m.station, 'LZIB');
  assert.equal(m.obsTime, '2026-11-01T10:30:00.000Z');
  assert.equal(m.tempC, -2);
  assert.equal(m.dewC, -5);
  assert.equal(m.windDirDeg, null);
  assert.equal(m.windKmh, 6);
  assert.equal(m.gustKmh, 28);
});

test('local time in Europe/Bratislava (CET/CEST)', () => {
  assert.equal(localParts(new Date('2026-07-01T10:05:00Z'), 'Europe/Bratislava').iso, '2026-07-01T12:05');
  assert.equal(localParts(new Date('2026-12-31T23:30:00Z'), 'Europe/Bratislava').iso, '2027-01-01T00:30');
});

test('forecast picks next 8 hours and 3 days from tomorrow', () => {
  const cfg = loadConfig();
  const { forecast } = readFixtureInputs('live');
  const { hours, days } = parseForecast(forecast, cfg, '2026-11-01T12:22');
  assert.equal(hours.length, 8);
  assert.equal(hours[0].time, '2026-11-01T13:00');
  assert.equal(days.length, 3);
  assert.equal(days[0].date, '2026-11-02');
  assert.ok(hours.every((h) => h.tempC !== null && h.precipProb !== null), 'fallback fills missing values');
});

test('showcase fixture builds complete data', () => {
  const data = buildData(readFixtureInputs('showcase'));
  assert.equal(data.local.date, '01/11');
  assert.equal(data.local.weekday, 'Nedeľa');
  assert.equal(data.days[0].weekday, 'Po');
  assert.equal(data.metar?.windDir, 'JZ');
  assert.equal(data.metar?.gustKmh, 57);
});

test('layout holes are byte aligned', () => {
  assert.doesNotThrow(() => loadLayout());
});

test('1-bit packing: MSB first, 1 = black, holes cleared', () => {
  const w = 16, h = 2;
  const grey = new Uint8Array(w * h).fill(255);
  grey[0] = 0; // x=0,y=0 black
  grey[9] = 10; // x=9,y=0 black
  grey[w + 15] = 0; // x=15,y=1 black
  const bits = packBits(threshold(grey, w, h, 128), w, h);
  assert.deepEqual([...bits], [0x80, 0x40, 0x00, 0x01]);

  const cleared = threshold(grey, w, h, 128, { width: w, height: h, holes: { a: { x: 8, y: 0, w: 8, h: 2 } } });
  assert.deepEqual([...packBits(cleared, w, h)], [0x80, 0x00, 0x00, 0x00]);
});
