/**
 * Renders template/dashboard.html with out/data.json in headless Chromium and writes
 * out/dashboard.png (1-bit), out/dashboard.bin (raw 1 bpp) and out/meta.json.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { OUT, loadConfig, loadLayout, readJson } from './common.ts';
import { startServer } from './server.ts';
import { convert } from './to-1bit.ts';
import type { DashboardData } from './build-data.ts';

const cfg = loadConfig();
const layout = loadLayout();
const data = readJson<DashboardData>(join(OUT, 'data.json'));

const { server, url } = await startServer();
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: layout.width, height: layout.height }, deviceScaleFactor: 1 });
  page.on('console', (msg) => msg.type() === 'error' && console.error(`[template] ${msg.text()}`));
  await page.goto(`${url}/template/dashboard.html`);
  await page.waitForSelector('body[data-ready]');
  const state = await page.getAttribute('body', 'data-ready');
  if (state !== '1') throw new Error(`Template failed: ${await page.getAttribute('body', 'data-error')}`);

  const screenshot = await page.screenshot({ type: 'png' });
  writeFileSync(join(OUT, 'raw.png'), screenshot); // anti-aliased original, handy for comparing with the 1-bit result
  const { bin, png, hash } = await convert(screenshot, layout, cfg.threshold);

  writeFileSync(join(OUT, 'dashboard.bin'), bin);
  writeFileSync(join(OUT, 'dashboard.png'), png);
  writeFileSync(
    join(OUT, 'meta.json'),
    JSON.stringify(
      {
        hash,
        generatedAt: data.generatedAt,
        localTime: data.local.time,
        metarTime: data.metar?.obsTimeLocal ?? null,
        width: layout.width,
        height: layout.height,
        bytes: bin.length,
        format: '1bpp row-major MSB-first, 1=black',
      },
      null,
      2,
    ),
  );
  console.log(`out/dashboard.png + dashboard.bin (${bin.length} B, hash ${hash})`);
} finally {
  await browser.close();
  server.close();
}
