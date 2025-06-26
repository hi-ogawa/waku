/* eslint-disable */
import { Hono } from 'hono';
import handler, { handleBuild } from './entry.rsc.js';
import { honoEnhancer } from 'virtual:vite-rsc-waku/hono-enhancer';
import { flags, config } from 'virtual:vite-rsc-waku/config';
import { compress } from 'hono/compress';
import { serveStatic } from '@hono/node-server/serve-static';
import path from 'node:path';
import fs from 'node:fs';
import { DIST_PUBLIC } from '../lib/builder/constants.js';

export const app = honoEnhancer(createApp)(new Hono());

function createApp(app: Hono) {
  if (flags['experimental-compress']) {
    app.use(compress());
  }
  if (import.meta.env.WAKU_DEPLOY_SERVE_STATIC) {
    app.use(serveStatic({ root: path.join(config.distDir, DIST_PUBLIC) }));
  }
  app.use((ctx) => handler(ctx.req.raw));
  app.notFound((c) => {
    const file = path.join(config.distDir, DIST_PUBLIC, '404.html');
    if (fs.existsSync(file)) {
      return c.html(fs.readFileSync(file, 'utf8'), 404);
    }
    return c.text('404 Not Found', 404);
  });
  return app;
}

export default app.fetch;
export { handleBuild };
