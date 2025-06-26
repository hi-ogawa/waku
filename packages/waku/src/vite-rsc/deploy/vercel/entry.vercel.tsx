import { app } from '../../entry.rsc.default.js';
import { getRequestListener } from '@hono/node-server';

export default getRequestListener(app.fetch);
