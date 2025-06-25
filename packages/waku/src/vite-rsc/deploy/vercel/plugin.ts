import type { Plugin } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

export function wakuDeployVercelPlugin(): Plugin {
  return {
    name: 'waku:deploy-vercel',
    config() {
      return {
        environments: {
          rsc: {
            build: {
              rollupOptions: {
                input: {
                  vercel: 'waku/vite-rsc/deploy/vercel/entry.vercel',
                },
              },
            },
          },
        },
      };
    },
    writeBundle: {
      order: 'post',
      sequential: true,
      async handler() {
        if (this.environment.name !== 'ssr') return;
        await buildVercel();
      },
    },
  };
}

// copied from my own adapter for now
// https://github.com/hi-ogawa/rsc-movies/blob/8e350bf8328b67e94cffe95abd6a01881ecd937d/vite.config.ts#L48
async function buildVercel() {
  const adapterDir = './.vercel/output';
  const clientDir = './dist/public';
  fs.rmSync(adapterDir, { recursive: true, force: true });
  fs.mkdirSync(adapterDir, { recursive: true });
  fs.writeFileSync(
    path.join(adapterDir, 'config.json'),
    JSON.stringify(
      {
        version: 3,
        trailingSlash: false,
        routes: [
          {
            src: '^/assets/(.*)$',
            headers: {
              'cache-control': 'public, immutable, max-age=31536000',
            },
          },
          {
            handle: 'filesystem',
          },
          {
            src: '.*',
            dest: '/',
          },
        ],
        overrides: {},
      },
      null,
      2,
    ),
  );

  // static
  fs.mkdirSync(path.join(adapterDir, 'static'), { recursive: true });
  fs.cpSync(clientDir, path.join(adapterDir, 'static'), {
    recursive: true,
  });

  // function config
  const functionDir = path.join(adapterDir, 'functions/index.func');
  fs.mkdirSync(functionDir, {
    recursive: true,
  });
  fs.writeFileSync(
    path.join(functionDir, '.vc-config.json'),
    JSON.stringify(
      {
        runtime: 'nodejs22.x',
        handler: 'dist/rsc/vercel.js',
        launcherType: 'Nodejs',
      },
      null,
      2,
    ),
  );

  // copy server entry and dependencies
  const { nodeFileTrace } = await import('@vercel/nft');
  const serverEntry = path.join(clientDir, '../rsc/vercel.js');
  const result = await nodeFileTrace([serverEntry]);
  for (const file of result.fileList) {
    const dest = path.join(functionDir, file);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    // preserve pnpm node_modules releative symlinks
    const stats = fs.lstatSync(file);
    if (stats.isSymbolicLink()) {
      const link = fs.readlinkSync(file);
      fs.symlinkSync(link, dest);
    } else {
      fs.copyFileSync(file, dest);
    }
  }
}
