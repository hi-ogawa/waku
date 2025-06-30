import { createHonoHandler } from 'waku/vite-rsc/entry.rsc';
import { Hono } from 'hono';

const app = new Hono();
app.use(createHonoHandler());

export default {
  fetch: app.fetch,
};
