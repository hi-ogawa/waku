import { getRequestListener } from '@hono/node-server';
import { app, handleBuild } from '../../entry.rsc.node.js';

export default getRequestListener(app.fetch);
export { handleBuild };
