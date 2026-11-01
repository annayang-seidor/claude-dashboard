import { request } from 'node:http';
import { createServer, type AddressInfo } from 'node:net';
import type { ServerType } from '@hono/node-server';
import { afterEach, describe, expect, it } from 'vitest';
import { TOKEN_HEADER, TOKEN_REFRESH_PATH } from '../shared/config';
import { allowLists, createApp } from './app';
import { listen } from './listen';

const PORT = 4317;
const TOKEN = 'test-token-0123456789abcdefghijklmnop';
const PREVIOUS = 'old-token-0123456789abcdefghijklmnopq';
const OWN_ORIGIN = `http://127.0.0.1:${PORT}`;
const DEV_ORIGIN = 'http://127.0.0.1:5173';

function makeApp() {
  const app = createApp({ ...allowLists(PORT, DEV_ORIGIN), token: TOKEN, previousToken: PREVIOUS });
  // Stand-in for the mutating routes later tasks add (PATCH, trash, resume).
  app.post('/api/echo', (c) => c.json({ ok: true }));
  return app;
}

function send(
  method: string,
  path: string,
  headers: Record<string, string | undefined> = {},
): Promise<Response> {
  const merged: Record<string, string> = {};
  const all = { host: `127.0.0.1:${PORT}`, [TOKEN_HEADER]: TOKEN, ...headers };
  for (const [k, v] of Object.entries(all)) if (v !== undefined) merged[k] = v;
  return Promise.resolve(
    makeApp().request(`http://127.0.0.1:${PORT}${path}`, { method, headers: merged }),
  );
}

describe('GET /api/health', () => {
  it('returns { ok: true } with a valid Host and token', async () => {
    const res = await send('GET', '/api/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('accepts localhost:4317 as Host', async () => {
    expect((await send('GET', '/api/health', { host: `localhost:${PORT}` })).status).toBe(200);
  });
});

describe('Host check (DNS rebinding)', () => {
  it.each([
    ['attacker domain', `evil.example:${PORT}`],
    ['rebound name on the right port', `rebind.attacker.test:${PORT}`],
    ['loopback on another port', '127.0.0.1:8080'],
    ['loopback without port', '127.0.0.1'],
    ['LAN address', `192.168.1.10:${PORT}`],
  ])('403 for a forged Host: %s', async (_label, host) => {
    const res = await send('GET', '/api/health', { host });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden host' });
  });

  it('403 when Host is missing', async () => {
    expect((await send('GET', '/api/health', { host: undefined })).status).toBe(403);
  });

  it('applies to non-API paths too', async () => {
    expect((await send('GET', '/', { host: `evil.example:${PORT}` })).status).toBe(403);
  });
});

describe('Origin check (CSRF)', () => {
  it.each([
    ['foreign site', 'https://evil.example'],
    ['loopback on another port', 'http://127.0.0.1:8080'],
    ['https variant of own origin', `https://127.0.0.1:${PORT}`],
    ['opaque origin (sandboxed iframe, file://)', 'null'],
  ])('403 for a forged Origin on POST: %s', async (_label, origin) => {
    const res = await send('POST', '/api/echo', { origin });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden origin' });
  });

  it('403 for a POST with no Origin', async () => {
    expect((await send('POST', '/api/echo')).status).toBe(403);
  });

  it.each(['PUT', 'PATCH', 'DELETE'])('403 for a forged Origin on %s', async (method) => {
    expect((await send(method, '/api/echo', { origin: 'https://evil.example' })).status).toBe(403);
  });

  it.each([OWN_ORIGIN, `http://localhost:${PORT}`, DEV_ORIGIN])(
    'allows POST from %s',
    async (origin) => {
      expect((await send('POST', '/api/echo', { origin })).status).toBe(200);
    },
  );
});

describe('token', () => {
  it('403 when the token header is missing', async () => {
    const res = await send('GET', '/api/health', { [TOKEN_HEADER]: undefined });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden token' });
  });

  it.each([
    ['wrong value, same length', TOKEN.replace(/.$/, 'X')],
    ['prefix of the token', TOKEN.slice(0, 10)],
    ['empty', ''],
  ])('403 for a wrong token: %s', async (_label, token) => {
    expect((await send('GET', '/api/health', { [TOKEN_HEADER]: token })).status).toBe(403);
  });

  it('403 for a POST from an allowed Origin without the token', async () => {
    const res = await send('POST', '/api/echo', { origin: OWN_ORIGIN, [TOKEN_HEADER]: undefined });
    expect(res.status).toBe(403);
  });
});

describe('token refresh (ADR 0048)', () => {
  it('trades the previous token for the current one', async () => {
    const res = await send('POST', TOKEN_REFRESH_PATH, {
      origin: OWN_ORIGIN,
      [TOKEN_HEADER]: PREVIOUS,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ token: TOKEN });
  });

  it('also answers the current token', async () => {
    const res = await send('POST', TOKEN_REFRESH_PATH, { origin: OWN_ORIGIN });
    expect(await res.json()).toEqual({ token: TOKEN });
  });

  it.each([
    ['another route', 'POST', '/api/echo', { origin: OWN_ORIGIN, [TOKEN_HEADER]: PREVIOUS }],
    ['a GET', 'GET', TOKEN_REFRESH_PATH, { [TOKEN_HEADER]: PREVIOUS }],
    ['a wrong token', 'POST', TOKEN_REFRESH_PATH, { origin: OWN_ORIGIN, [TOKEN_HEADER]: 'x' }],
    ['no token', 'POST', TOKEN_REFRESH_PATH, { origin: OWN_ORIGIN, [TOKEN_HEADER]: undefined }],
    [
      'another Origin',
      'POST',
      TOKEN_REFRESH_PATH,
      { origin: 'https://evil.example', [TOKEN_HEADER]: PREVIOUS },
    ],
    [
      'another Host',
      'POST',
      TOKEN_REFRESH_PATH,
      { host: 'evil.example:4317', origin: OWN_ORIGIN, [TOKEN_HEADER]: PREVIOUS },
    ],
  ])('403 for the previous token on %s', async (_label, method, path, headers) => {
    expect((await send(method, path, headers)).status).toBe(403);
  });

  it('403 for any token but the current one when there was no rotation', async () => {
    const app = createApp({ ...allowLists(PORT), token: TOKEN });
    const res = await app.request(`http://127.0.0.1:${PORT}${TOKEN_REFRESH_PATH}`, {
      method: 'POST',
      headers: { host: `127.0.0.1:${PORT}`, origin: OWN_ORIGIN, [TOKEN_HEADER]: PREVIOUS },
    });
    expect(res.status).toBe(403);
  });
});

describe('real server', () => {
  let server: ServerType | undefined;
  afterEach(() => new Promise<void>((done) => (server ? server.close(() => done()) : done())));

  function freePort(): Promise<number> {
    return new Promise((resolve) => {
      const probe = createServer().listen(0, '127.0.0.1', () => {
        const { port } = probe.address() as AddressInfo;
        probe.close(() => resolve(port));
      });
    });
  }

  function rawGet(port: number, host: string): Promise<number> {
    return new Promise((resolve, reject) => {
      const req = request(
        { host: '127.0.0.1', port, path: '/api/health', headers: { host, [TOKEN_HEADER]: TOKEN } },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      );
      req.on('error', reject);
      req.end();
    });
  }

  it('binds 127.0.0.1 only and enforces Host on the wire', async () => {
    const port = await freePort();
    const app = createApp({ ...allowLists(port), token: TOKEN });
    const started = await listen(app, port);
    server = started.server;

    expect(started.address.address).toBe('127.0.0.1');
    expect(await rawGet(port, `127.0.0.1:${port}`)).toBe(200);
    expect(await rawGet(port, `evil.example:${port}`)).toBe(403);
  });
});
