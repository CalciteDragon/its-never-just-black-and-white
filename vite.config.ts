/// <reference types="vitest/config" />
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

/**
 * Dev-only helper: POST a base64 PNG (raw body, optionally with a data-URL
 * prefix) to `/__shot?file=docs/screenshot.png` and it lands on disk relative
 * to the project root. Lets automated workflows capture real gameplay
 * screenshots straight from the canvas. Never part of the production build.
 */
function screenshotSink(): Plugin {
  return {
    name: 'bw:screenshot-sink',
    configureServer(server) {
      server.middlewares.use('/__shot', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end('POST only');
          return;
        }
        req.setEncoding('utf8');
        let body = '';
        req.on('data', (chunk: string) => {
          body += chunk;
        });
        req.on('end', () => {
          try {
            const url = new URL(req.url ?? '/', 'http://localhost');
            const rel = (url.searchParams.get('file') ?? 'screenshot.png').replace(/\\/g, '/');
            if (rel.split('/').some((part) => part === '..' || part === '')) {
              res.statusCode = 400;
              res.end('bad path');
              return;
            }
            const b64 = body.replace(/^data:image\/png;base64,/, '');
            const path = resolve(process.cwd(), rel);
            mkdirSync(dirname(path), { recursive: true });
            writeFileSync(path, b64, 'base64');
            res.statusCode = 200;
            res.end(`saved ${rel}`);
          } catch (e) {
            res.statusCode = 500;
            res.end(String(e));
          }
        });
      });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [screenshotSink()],
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    target: 'es2022',
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
