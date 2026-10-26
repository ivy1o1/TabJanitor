/*
 * Development-only static server for the frontend. It exists so the dashboard can be
 * opened over http://127.0.0.1 (ES modules are blocked from file://), and it serves no
 * backend logic: the frontend performs no I/O of its own.
 *
 *   npm run serve:frontend   ->  http://127.0.0.1:4173/frontend/dashboard.html
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const host = '127.0.0.1';
const port = Number(process.env.PORT || 4173);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
};

const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://${host}`);
  const requested = url.pathname === '/' ? '/frontend/dashboard.html' : decodeURIComponent(url.pathname);
  const target = join(root, normalize(requested).replace(/^(\.\.[/\\])+/, ''));

  if (!target.startsWith(root)) {
    response.writeHead(403).end('Forbidden');
    return;
  }

  try {
    const body = await readFile(target);
    response.writeHead(200, {
      'Content-Type': TYPES[extname(target).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    response.end(body);
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end(`Not found: ${requested}`);
  }
});

server.listen(port, host, () => {
  console.log(`TabJanitor frontend: http://${host}:${port}/frontend/dashboard.html`);
});
