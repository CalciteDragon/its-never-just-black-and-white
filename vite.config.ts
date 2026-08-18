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

/**
 * The same charset as `LEVEL_ID_PATTERN` in `src/engine/levelio.ts`, duplicated
 * on purpose: a vite config must not import from `src/`, and the alternative —
 * a third file both could import — would be a module that exists solely to be
 * shared between a browser bundle and a node config. Keep the two in step.
 */
const LEVEL_ID_RE = /^[a-z0-9][a-z0-9-]*$/;

/**
 * Dev-only helper: the editor POSTs a level's JSON to `/__level?id=<id>` and it
 * lands in `src/levels/<id>.json`, so a level drawn in the browser becomes a
 * committable file without anyone opening a text editor (PHASES phase 7).
 *
 * Modelled on `screenshotSink` in every respect but one, and that one is the
 * point: **it takes no path from the caller.** `screenshotSink` accepts a
 * `?file=` and then tries to prove the path is safe, rejecting `..` and empty
 * segments — a denylist over path syntax, which is precisely the family of
 * check that keeps being wrong (backslash and unicode normalisation, percent
 * re-decoding, an absolute path or a drive letter that never contains `..` at
 * all, a symlinked directory). This sink accepts an *id*, admits it only if it
 * matches an allowlist that cannot express a separator, and then builds the
 * path itself. There is no traversal to detect because there is no
 * caller-supplied path: the worst a hostile request can do is overwrite a
 * `.json` inside `src/levels`, which is the one thing the endpoint is for.
 *
 * It deliberately does NOT touch `src/levels/index.ts`. Adding the import there
 * would mean a middleware rewriting a TypeScript source file — codegen, in a
 * dev server, against a file under version control. The honest alternative is a
 * one-line manual edit, and `saveLevel`'s on-screen confirmation names it.
 *
 * Never part of the production build. A build (and `vite preview`) has no
 * middleware at all, which is what makes `saveLevel`'s localStorage-plus-
 * clipboard fallback a real path rather than dead code.
 */
function levelSink(): Plugin {
  return {
    name: 'bw:level-sink',
    configureServer(server) {
      server.middlewares.use('/__level', (req, res) => {
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
            const id = url.searchParams.get('id') ?? '';
            if (!LEVEL_ID_RE.test(id)) {
              res.statusCode = 400;
              res.end('bad level id: lowercase letters, digits and -, not starting with -');
              return;
            }
            const rel = `src/levels/${id}.json`;
            const path = resolve(process.cwd(), 'src/levels', `${id}.json`);
            mkdirSync(dirname(path), { recursive: true });
            // The body is written verbatim: it is already `serializeLevel`'s
            // exact bytes (2-space JSON, trailing newline), and re-serialising
            // here would be a second formatter to keep in step with the first.
            writeFileSync(path, body, 'utf8');
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
  plugins: [screenshotSink(), levelSink()],
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
