import { app } from '../../entry.rsc.js';
import { getRequestListener } from '@hono/node-server';
export default getRequestListener(app.fetch);
