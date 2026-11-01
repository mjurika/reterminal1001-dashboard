/** Saves the current live API responses into fixtures/live/ for offline development and tests. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FIXTURES } from './common.ts';
import { fetchInputs } from './build-data.ts';

const inputs = await fetchInputs();
const dir = join(FIXTURES, process.argv[2] ?? 'live');
mkdirSync(dir, { recursive: true });
const capturedAt = inputs.now.toISOString();
writeFileSync(join(dir, 'metar.json'), JSON.stringify({ capturedAt, ...inputs.metar }, null, 2));
writeFileSync(join(dir, 'forecast.json'), JSON.stringify({ capturedAt, body: inputs.forecast }, null, 2));
console.log(`Fixtures recorded to ${dir}`);
