import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { allowLists, createApp } from './app';

const PORT = 4317;
const webRoot = mkdtempSync(join(tmpdir(), 'app-test-'));
mkdirSync(join(webRoot, 'assets'));
writeFileSync(join(webRoot, 'index.html'), '<div id="root"></div>');
writeFileSync(join(webRoot, 'assets', 'index-abc123.js'), 'console.log(1);');
writeFileSync(join(webRoot, 'clawd-sparkles.svg'), '<svg/>');
afterAll(() => rmSync(webRoot, { recursive: true, force: true }));

const app = createApp({ ...allowLists(PORT), token: 't', webRoot });
const get = (path: string) =>
  app.request(`http://127.0.0.1:${PORT}${path}`, { headers: { host: `127.0.0.1:${PORT}` } });

describe('static files (ADR 0050)', () => {
  it.each(['/', '/index.html', '/work', '/personal?t=x'])(
    'serves the app shell for %s with no-cache',
    async (path) => {
      const res = await get(path);
      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toBe('no-cache');
      expect(await res.text()).toBe('<div id="root"></div>');
    },
  );

  it('caches a hashed asset for good', async () => {
    const res = await get('/assets/index-abc123.js');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('javascript');
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
  });

  it('404s a missing asset instead of sending the app shell', async () => {
    const res = await get('/assets/index-gone.js');
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).not.toContain('text/html');
  });

  it('serves other root files without the immutable header', async () => {
    const res = await get('/clawd-sparkles.svg');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-cache');
  });
});
