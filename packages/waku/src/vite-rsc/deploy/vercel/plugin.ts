import { normalizePath, type Plugin } from 'vite';
import path from 'node:path';
import { rmSync, cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import type { Config } from '../../../config.js';

const SERVE_JS = 'serve-vercel.js';

export function wakuDeployVercelPlugin(deployOptions: {
  serverless: boolean;
  wakuConfig: Required<Config>;
}): Plugin {
  return {
    name: 'waku:deploy-vercel',
    config() {
      return {
        define: {
          'import.meta.env.WAKU_SERVE_STATIC': JSON.stringify(false),
        },
        environments: {
          rsc: {
            build: {
              rollupOptions: {
                input: {
                  [SERVE_JS.split('.')[0]!]:
                    'waku/vite-rsc/deploy/vercel/entry',
                },
              },
            },
          },
        },
      };
    },
    // "post ssr writeBundle" is a signal that the entire build is finished.
    // this can be replaced with `buildApp` hook on Vite 7 https://github.com/vitejs/vite/pull/19971
    writeBundle: {
      order: 'post',
      sequential: true,
      async handler() {
        if (this.environment.name !== 'ssr') {
          return;
        }
        const config = this.environment.getTopLevelConfig();
        const opts = deployOptions.wakuConfig;
        const rootDir = config.root;
        const publicDir = config.environments.client!.build.outDir;
        const outputDir = path.resolve('.vercel', 'output');
        cpSync(publicDir, path.join(outputDir, 'static'), { recursive: true });

        if (deployOptions.serverless) {
          // for serverless function
          // TODO: use @vercel/nft to support native dependencies
          const serverlessDir = path.join(
            outputDir,
            'functions',
            opts.rscBase + 'index.func',
          );
          rmSync(serverlessDir, { recursive: true, force: true });
          mkdirSync(path.join(serverlessDir, opts.distDir), {
            recursive: true,
          });
          cpSync(
            config.environments.rsc!.build.outDir,
            path.join(serverlessDir, opts.distDir, 'rsc'),
            { recursive: true },
          );
          cpSync(
            config.environments.ssr!.build.outDir,
            path.join(serverlessDir, opts.distDir, 'ssr'),
            { recursive: true },
          );
          if (existsSync(path.join(rootDir, opts.privateDir))) {
            cpSync(
              path.join(rootDir, opts.privateDir),
              path.join(serverlessDir, opts.privateDir),
              { recursive: true, dereference: true },
            );
          }
          const vcConfigJson = {
            runtime: 'nodejs22.x',
            handler: normalizePath(
              path.relative(
                process.cwd(),
                path.join(config.environments.rsc!.build.outDir, SERVE_JS),
              ),
            ),
            launcherType: 'Nodejs',
          };
          writeFileSync(
            path.join(serverlessDir, '.vc-config.json'),
            JSON.stringify(vcConfigJson, null, 2),
          );
          writeFileSync(
            path.join(serverlessDir, 'package.json'),
            JSON.stringify({ type: 'module' }, null, 2),
          );
        }

        const routes = deployOptions.serverless
          ? [
              { handle: 'filesystem' },
              {
                src: opts.basePath + '(.*)',
                dest: opts.basePath + opts.rscBase + '/',
              },
            ]
          : undefined;
        const configJson = { version: 3, routes };
        mkdirSync(outputDir, { recursive: true });
        writeFileSync(
          path.join(outputDir, 'config.json'),
          JSON.stringify(configJson, null, 2),
        );
      },
    },
  };
}
