import type { AddressInfo } from 'node:net';
import { serve, type ServerType } from '@hono/node-server';
import type { Hono } from 'hono';
import { SERVER_HOST } from '../shared/config';

/** Start the app on the loopback interface only. Resolves once listening. */
export function listen(
  app: Hono,
  port: number,
): Promise<{ server: ServerType; address: AddressInfo }> {
  return new Promise((resolve) => {
    const server = serve({ fetch: app.fetch, hostname: SERVER_HOST, port }, (address) =>
      resolve({ server, address }),
    );
  });
}
