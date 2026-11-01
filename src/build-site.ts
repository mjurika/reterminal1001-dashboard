/** Assembles site/ for GitHub Pages, with the same layout as src/server.ts serves locally. */
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FONTS, OUT, ROOT, SITE } from './common.ts';

rmSync(SITE, { recursive: true, force: true });
mkdirSync(join(SITE, 'fonts'), { recursive: true });

for (const f of ['dashboard.png', 'dashboard.bin', 'meta.json', 'data.json']) {
  if (!existsSync(join(OUT, f))) throw new Error(`out/${f} missing — run fetch + render first`);
  cpSync(join(OUT, f), join(SITE, f));
}
cpSync(join(ROOT, 'layout.json'), join(SITE, 'layout.json'));
cpSync(join(ROOT, 'preview', 'index.html'), join(SITE, 'index.html'));
cpSync(join(ROOT, 'template'), join(SITE, 'template'), { recursive: true });
for (const w of [500, 600, 700]) {
  for (const subset of ['latin', 'latin-ext']) {
    const f = `barlow-condensed-${subset}-${w}-normal.woff2`;
    cpSync(join(FONTS, f), join(SITE, 'fonts', f));
  }
}
writeFileSync(join(SITE, '.nojekyll'), '');
console.log('site/ ready');
