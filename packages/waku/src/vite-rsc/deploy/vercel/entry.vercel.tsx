import { Hono } from 'hono';
import handler from '../../entry.rsc.js';
import { getRequestListener } from '@hono/node-server';

const app = new Hono();
app.use((ctx) => handler(ctx.req.raw));
export default getRequestListener(app.fetch);
