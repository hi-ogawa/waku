import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export async function cli(options: { cmd: string; port: string | undefined }) {
  let configFile: string | undefined;

  if (fs.existsSync('waku-vite-rsc.config.ts')) {
    // allow a dedicated config file for Vite RSC port
    configFile = 'waku-vite-rsc.config.ts';
  } else if (!fs.existsSync('vite.config.ts')) {
    // auto setup vite.config.ts in a hidden place
    const configCode = `\
import waku from "waku/vite-rsc/plugin";

export default {
  plugins: [waku()],
};
`;
    configFile = `node_modules/.cache/waku/vite-vite-rsc.config.${hashString(configCode)}.ts`;
    if (!fs.existsSync(configFile)) {
      fs.mkdirSync(path.dirname(configFile), { recursive: true });
      fs.writeFileSync(configFile, configCode);
    }
  }

  if (options.cmd === 'dev') {
    const vite = await import('vite');
    const waku = (await import('./plugin.js')).default;
    const port = parseInt(options.port || '3000', 10);
    const server = await vite.createServer({
      configFile: false,
      plugins: [waku()],
      server: {
        port,
      },
    });
    await server.listen();
    server.printUrls();
    server.bindCLIShortcuts();
  }

  if (options.cmd === 'build') {
    const vite = await import('vite');
    const waku = (await import('./plugin.js')).default;
    const builder = await vite.createBuilder({
      configFile: false,
      plugins: [waku()],
    });
    await builder.buildApp();
  }

  if (options.cmd === 'start') {
    // TODO: Vite preview can be replaced with own Hono server
    const vite = await import('vite');
    const waku = (await import('./plugin.js')).default;
    const port = parseInt(options.port || '8080', 10);
    const server = await vite.preview({
      configFile: false,
      plugins: [waku()],
      preview: {
        port,
      },
    });
    server.printUrls();
    server.bindCLIShortcuts();
  }
}

function hashString(v: string) {
  return createHash('sha256').update(v).digest().toString('hex').slice(0, 10);
}
