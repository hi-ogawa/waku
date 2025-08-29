import * as vite from 'vite';
import { rscPlugin } from './plugin.js';
import type { Flags, RscPluginOptions } from './plugin.js';
import type { Config } from '../../config.js';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const logger = vite.createLogger(undefined, { prefix: '[waku]' });

async function loadConfig(): Promise<Config | undefined> {
  let config: Config | undefined;
  if (existsSync('waku.config.ts') || existsSync('waku.config.js')) {
    const imported = await vite.runnerImport<{ default: Config }>(
      '/waku.config',
    );
    config = imported.module.default;
  }
  return config;
}

async function startDevServer(
  port: number,
  rscPluginOptions: RscPluginOptions,
) {
  const server = await vite.createServer({
    configFile: false,
    plugins: [rscPlugin(rscPluginOptions)],
    server: { port, host: false },
  });
  await server.listen();
  server.printUrls();
  server.bindCLIShortcuts({
    print: true,
    customShortcuts: [
      {
        // overwrite vite's default server restart
        key: 'r',
        description: 'restart the server',
        action: async () => {
          logger.info('restarting server...', { timestamp: true });
          await restartServer();
        },
      },
    ],
  });

  async function restartServer() {
    await server.close();
    await startDevServer(port, {
      ...rscPluginOptions,
      config: await loadConfig(),
    });
  }

  const watcher = server.watcher;
  watcher.on('change', handleConfigChange);
  watcher.on('unlink', handleConfigChange);
  watcher.on('add', handleConfigChange);

  async function handleConfigChange(changedFile: string) {
    const dirname = path.dirname(changedFile);
    const filename = path.basename(changedFile);
    if (
      dirname === process.cwd() &&
      (filename === 'waku.config.ts' || filename === 'waku.config.js')
    ) {
      logger.info(`configuration file changed, restarting server...`, {
        timestamp: true,
      });
      restartServer();
    }
  }
}

export async function cli(
  cmd: 'dev' | 'build' | 'start',
  flags: { port?: string } & Flags,
) {
  // set NODE_ENV before runnerImport https://github.com/vitejs/vite/issues/20299
  process.env.NODE_ENV ??= cmd === 'dev' ? 'development' : 'production';

  const rscPluginOptions: RscPluginOptions = {
    flags,
    config: await loadConfig(),
  };

  if (cmd === 'dev') {
    const port = parseInt(flags.port || '3000', 10);
    await startDevServer(port, rscPluginOptions);
  } else if (cmd === 'build') {
    const builder = await vite.createBuilder({
      configFile: false,
      plugins: [rscPlugin(rscPluginOptions)],
    });
    await builder.buildApp();
  } else if (cmd === 'start') {
    const port = parseInt(flags.port || '8080', 10);
    const { serve } = await import('@hono/node-server');
    const distDir = rscPluginOptions.config?.distDir ?? 'dist';
    const entry: typeof import('../vite-entries/entry.server.js') =
      await import(
        pathToFileURL(path.resolve(distDir, 'server', 'index.js')).href
      );
    await startServer(port);
    function startServer(port: number) {
      return new Promise<void>((resolve, reject) => {
        const server = serve({ fetch: entry.default, port }, () => {
          console.log(`ready: Listening on http://localhost:${port}/`);
          resolve();
        });
        server.on('error', (err: NodeJS.ErrnoException) => {
          if (err.code === 'EADDRINUSE') {
            console.log(
              `warn: Port ${port} is in use, trying ${port + 1} instead.`,
            );
            startServer(port + 1)
              .then(resolve)
              .catch(reject);
          } else {
            console.error(`Failed to start server: ${err.message}`);
          }
        });
      });
    }
  }
}
