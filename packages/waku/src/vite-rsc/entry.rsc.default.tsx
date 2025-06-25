import { Hono } from 'hono';
import handler from './entry.rsc.js';
import { honoEnhancer } from 'virtual:vite-rsc-waku/hono-enhancer';

export const app = honoEnhancer<Hono>(createApp)(new Hono());

function createApp(app: Hono): Hono {
  // TODO: experimental-compress
  // TODO: notFound
  // TODO: serveStatic
  app.use((ctx) => handler(ctx.req.raw));
  return app;
}
