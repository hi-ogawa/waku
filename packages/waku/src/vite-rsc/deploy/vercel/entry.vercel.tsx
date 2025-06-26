import { getRequestListener } from '@hono/node-server';
import { app } from '../../entry.rsc.default.js';

export default getRequestListener(app.fetch);
