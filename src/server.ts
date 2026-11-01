/**
 * Tiny static server that mirrors the GitHub Pages site layout, so the template and the
 * preview page work the same locally and online.
 *
 *   /                 preview/index.html
 *   /template/*       template/
 *   /fonts/*          @fontsource/barlow-condensed files
 *   /layout.json      layout.json
 *   /data.json, /meta.json, /dashboard.png, /dashboard.bin   out/
 */
import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { FONTS, OUT, ROOT } from './common.ts';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.bin': 'application/octet-stream',
};

function resolve(urlPath: string): string | null {
  const p = normalize(decodeURIComponent(urlPath)).replace(/\\/g, '/');
  if (p.includes('..')) return null;
  if (p === '/' || p === '/index.html') return join(ROOT, 'preview', 'index.html');
  if (p === '/layout.json') return join(ROOT, 'layout.json');
  if (p.startsWith('/template/')) return join(ROOT, p);
  if (p.startsWith('/fonts/')) return join(FONTS, p.slice('/fonts/'.length));
  if (/^\/(data|meta)\.json$|^\/dashboard\.(png|bin)$/.test(p)) return join(OUT, p);
  return null;
}

export function startServer(port = 0): Promise<{ server: Server; url: string }> {
  const server = createServer(async (req, res) => {
    const file = resolve(new URL(req.url ?? '/', 'http://x').pathname);
    if (!file) {
      res.writeHead(404).end('not found');
      return;
    }
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(body);
    } catch {
      res.writeHead(404).end(`not found: ${file}`);
    }
  });
  return new Promise((ok) =>
    server.listen(port, '127.0.0.1', () => {
      const addr = server.address();
      ok({ server, url: `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : port}` });
    }),
  );
}

if (process.argv[1]?.endsWith('server.ts')) {
  const { url } = await startServer(Number(process.env.PORT ?? 5173));
  console.log(`Preview:          ${url}/`);
  console.log(`Template:         ${url}/template/dashboard.html?holes=demo`);
  console.log(`Template 1-bit:   ${url}/template/dashboard.html?holes=demo&bw=1`);
  console.log(`Hole outlines:    ${url}/template/dashboard.html?holes=outline`);
  console.log('Data comes from out/data.json — run "npm run fetch" or "npm run fetch:fixtures" first.');
}
