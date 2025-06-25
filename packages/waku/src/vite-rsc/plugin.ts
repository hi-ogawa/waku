import {
  mergeConfig,
  normalizePath,
  runnerImport,
  type EnvironmentOptions,
  type Plugin,
  type PluginOption,
  type UserConfig,
} from 'vite';
import react from '@vitejs/plugin-react';
import rsc from '@hiogawa/vite-rsc/plugin';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import type { Config } from '../config.js';
import { unstable_getBuildOptions } from '../server.js';
import { emitStaticFile, waitForTasks } from '../lib/builder/build.js';
import {
  getManagedEntries,
  getManagedMain,
} from '../lib/plugins/vite-plugin-rsc-managed.js';
import { wakuDeployVercelPlugin } from './deploy/vercel/plugin.js';
import { wakuAllowServerPlugin } from './plugins/allow-server.js';

// TODO: refactor and reuse common plugins from lib/plugins

const PKG_NAME = 'waku';

export default function wakuViteRscPlugin(_wakuOptions?: {}): PluginOption {
  let wakuConfig: Config | undefined;
  let wakuFlags: Record<string, unknown> = {};
  // for now passed through main cli
  if (process.env.WAKU_VITE_RSC_FLAGS) {
    try {
      wakuFlags = JSON.parse(process.env.WAKU_VITE_RSC_FLAGS);
    } catch (e) {
      console.error('[failed to load cli flags]', e);
    }
  }

  return [
    react(),
    wakuAllowServerPlugin(), // apply `allowServer` DCE before "use client" transform
    rsc({
      keepUseCientProxy: true,
      ignoredPackageWarnings: [PKG_NAME],
      // by default, it copies only ".css" for security reasons.
      // this should expanded or exposed based on Waku's opinion.
      copyServerAssetsToClient: (fileName) =>
        fileName.endsWith('.css') ||
        fileName.endsWith('.txt') ||
        fileName.endsWith('.jpg') ||
        fileName.endsWith('.json'),
    }),
    {
      name: 'rsc:waku',
      async config(_config, env) {
        if (!env.isPreview) {
          try {
            const imported = await runnerImport<{ default: Config }>(
              '/waku.config',
            );
            wakuConfig = imported.module.default;
          } catch (e) {
            // ignore errors when waku.config doesn't exist
            if (
              !(
                e instanceof Error &&
                e.message ===
                  'Failed to load url /waku.config (resolved id: /waku.config). Does the file exist?'
              )
            ) {
              console.error(e);
            }
          }
        }

        const toEnvironmentOption = (entry: string) =>
          ({
            build: {
              rollupOptions: {
                input: {
                  index: `${PKG_NAME}/vite-rsc/${entry}`,
                },
              },
            },
          }) satisfies EnvironmentOptions;

        let viteRscConfig: UserConfig = {
          define: {
            'import.meta.env.WAKU_CONFIG_BASE_PATH': JSON.stringify('/'),
            'import.meta.env.WAKU_CONFIG_RSC_BASE': JSON.stringify('RSC'),
          },
          environments: {
            client: toEnvironmentOption('entry.browser'),
            ssr: toEnvironmentOption('entry.ssr'),
            rsc: toEnvironmentOption('entry.rsc'),
          },
        };

        // TODO: adding `plugins` here is not supported.
        viteRscConfig = mergeConfig(
          viteRscConfig,
          wakuConfig?.unstable_viteConfigs?.['common']?.() ?? {},
        );
        if (env.command === 'serve') {
          viteRscConfig = mergeConfig(
            viteRscConfig,
            wakuConfig?.unstable_viteConfigs?.['dev-main']?.() ?? {},
          );
        } else {
          viteRscConfig = mergeConfig(
            viteRscConfig,
            wakuConfig?.unstable_viteConfigs?.['build-server']?.() ?? {},
          );
        }
        return viteRscConfig;
      },
      configEnvironment(name, config, _env) {
        // make @hiogawa/vite-rsc usable as a transitive dependency
        // https://github.com/hi-ogawa/vite-plugins/issues/968
        if (config.optimizeDeps?.include) {
          config.optimizeDeps.include = config.optimizeDeps.include.map(
            (name) => {
              if (name.startsWith('@hiogawa/vite-rsc/')) {
                name = `${PKG_NAME} > ${name}`;
              }
              return name;
            },
          );
        }

        if (name === 'client') {
          config.build ??= {};
          config.build.outDir = 'dist/public';
          if (wakuFlags['experimental-partial']) {
            config.build.emptyOutDir = false;
          }
        }

        return {
          resolve: {
            noExternal: [PKG_NAME],
          },
          optimizeDeps: {
            include: name === 'ssr' ? [`${PKG_NAME} > html-react-parser`] : [],
            exclude: [PKG_NAME, 'waku/minimal/client', 'waku/router/client'],
          },
          build: {
            // top-level-await in packages/waku/src/lib/middleware/context.ts
            target:
              config.build?.target ??
              (name !== 'client' ? 'esnext' : undefined),
          },
        };
      },
      async configurePreviewServer(server) {
        // server ssg html
        // TODO: integrate hono
        const outDir = server.config.environments.client!.build.outDir;
        server.middlewares.use((req, _res, next) => {
          const url = new URL(req.url!, 'https://test.local');
          const htmlFile = url.pathname + '/index.html';
          if (fs.existsSync(path.join(outDir, htmlFile))) {
            req.url = htmlFile;
          }
          next();
        });
      },
    },
    {
      name: 'rsc:waku:user-entries',
      // resolve user entries or fallbacks to "managed mode"
      async resolveId(source, _importer, options) {
        if (source === 'virtual:vite-rsc-waku/server-entry') {
          const resolved = await this.resolve(
            '/src/server-entry',
            undefined,
            options,
          );
          return resolved ? resolved : '\0' + source;
        }
        if (source === 'virtual:vite-rsc-waku/client-entry') {
          const resolved = await this.resolve(
            '/src/client-entry',
            undefined,
            options,
          );
          return resolved ? resolved : '\0' + source;
        }
      },
      load(id) {
        if (id === '\0virtual:vite-rsc-waku/server-entry') {
          return getManagedEntries(
            path.join(this.environment.config.root, 'src/server-entry.js'),
            'src',
            {
              pagesDir: 'pages',
              apiDir: 'api',
            },
          );
        }
        if (id === '\0virtual:vite-rsc-waku/client-entry') {
          return getManagedMain();
        }
      },
    },
    createVirtualPlugin('vite-rsc-waku/middlewares', async function () {
      // minor tweak on middleware convention
      // TODO: discuss
      const configMiddlware = wakuConfig?.middleware ?? [
        'waku/middleware/handler',
      ];
      const pre: string[] = [];
      const post: string[] = [];
      const builtins: string[] = [];
      for (const file of configMiddlware) {
        if (file.startsWith('waku/')) {
          builtins.push(file);
          continue;
        }
        let id = file;
        if (file[0] === '.') {
          const resolved = await this.resolve(file);
          if (resolved) {
            id = resolved.id;
          }
        }
        if (builtins.includes('waku/middleware/handler')) {
          post.push(id);
        } else {
          pre.push(id);
        }
      }
      if (!builtins.includes('waku/middleware/handler')) {
        this.warn(
          "'waku/middleware/handler' is not found in 'config.middlewares', but it is always enabled.",
        );
      }
      if (post.length > 0) {
        this.warn(
          "Post middlewares after 'waku/middleware/handler' are currently ignored. " +
            JSON.stringify(post),
        );
      }

      let code = '';
      pre.forEach((file, i) => {
        code += `import __m_${i} from ${JSON.stringify(file)};\n`;
      });
      code += `export const middlewares = [`;
      code += pre.map((_, i) => `__m_${i}`).join(',\n');
      code += `];\n`;
      return code;
    }),
    createVirtualPlugin('vite-rsc-waku/hono-enhancer', async function () {
      if (!wakuConfig?.unstable_honoEnhancer) {
        return `export const honoEnhancer = undefined;`;
      }
      let id = wakuConfig.unstable_honoEnhancer;
      if (id[0] === '.') {
        const resolved = await this.resolve(id);
        if (resolved) {
          id = resolved.id;
        }
      }
      return `
        export __m from ${JSON.stringify(id)};
        export const honoEnhancer = __m;
      `;
    }),
    {
      // rewrite `react-server-dom-webpack` in `waku/minimal/client`
      name: 'rsc:waku:patch-webpack',
      enforce: 'pre',
      resolveId(source, _importer, _options) {
        if (source === 'react-server-dom-webpack/client') {
          return '\0' + source;
        }
      },
      load(id) {
        if (id === '\0react-server-dom-webpack/client') {
          if (this.environment.name === 'client') {
            return `
              import * as ReactClient from ${JSON.stringify(import.meta.resolve('@hiogawa/vite-rsc/browser'))};
              export default ReactClient;
            `;
          }
          return `export default {}`;
        }
      },
    },
    {
      // cf. packages/waku/src/lib/plugins/vite-plugin-rsc-hmr.ts
      name: 'rsc:waku:patch-server-hmr',
      apply: 'serve',
      async transform(code, id) {
        if (this.environment.name !== 'client') {
          return;
        }
        if (id.includes('/waku/dist/minimal/client.js')) {
          return code.replace(
            /\nexport const fetchRsc = \(.*?\)=>\{/,
            (m) =>
              m +
              `
{
  const refetchRsc = () => {
    delete fetchCache[ENTRY];
    const data = fetchRsc(rscPath, rscParams, fetchCache);
    fetchCache[SET_ELEMENTS](() => data);
  };
  globalThis.__WAKU_RSC_RELOAD_LISTENERS__ ||= [];
  const index = globalThis.__WAKU_RSC_RELOAD_LISTENERS__.indexOf(globalThis.__WAKU_REFETCH_RSC__);
  if (index !== -1) {
    globalThis.__WAKU_RSC_RELOAD_LISTENERS__.splice(index, 1, refetchRsc);
  } else {
    globalThis.__WAKU_RSC_RELOAD_LISTENERS__.push(refetchRsc);
  }
  globalThis.__WAKU_REFETCH_RSC__ = refetchRsc;
}
`,
          );
        } else if (id.includes('/waku/dist/router/client.js')) {
          return code.replace(
            /\nconst InnerRouter = \(.*?\)=>\{/,
            (m) =>
              m +
              `
{
  const refetchRoute = () => {
    staticPathSetRef.current.clear();
    cachedIdSetRef.current.clear();
    const rscPath = encodeRoutePath(route.path);
    const rscParams = createRscParams(route.query, []);
    refetch(rscPath, rscParams);
  };
  globalThis.__WAKU_RSC_RELOAD_LISTENERS__ ||= [];
  const index = globalThis.__WAKU_RSC_RELOAD_LISTENERS__.indexOf(globalThis.__WAKU_REFETCH_ROUTE__);
  if (index !== -1) {
    globalThis.__WAKU_RSC_RELOAD_LISTENERS__.splice(index, 1, refetchRoute);
  } else {
    globalThis.__WAKU_RSC_RELOAD_LISTENERS__.unshift(refetchRoute);
  }
  globalThis.__WAKU_REFETCH_ROUTE__ = refetchRoute;
}
`,
          );
        }
      },
    },
    {
      name: 'rsc:waku:handle-build',
      resolveId(source) {
        if (source === 'virtual:vite-rsc-waku/set-platform-data') {
          assert.equal(this.environment.name, 'rsc');
          if (this.environment.mode === 'build') {
            return { id: source, external: true, moduleSideEffects: true };
          }
          return '\0' + source;
        }
      },
      async load(id) {
        if (id === '\0virtual:vite-rsc-waku/set-platform-data') {
          // no-op during dev
          assert.equal(this.environment.mode, 'dev');
          return `export {}`;
        }
      },
      renderChunk(code, chunk) {
        if (code.includes(`virtual:vite-rsc-waku/set-platform-data`)) {
          const replacement = normalizeRelativePath(
            path.relative(
              path.join(chunk.fileName, '..'),
              '__waku_set_platform_data.js',
            ),
          );
          return code.replaceAll(
            'virtual:vite-rsc-waku/set-platform-data',
            () => replacement,
          );
        }
      },
      // cf. packages/waku/src/lib/builder/build.ts
      writeBundle: {
        order: 'post',
        sequential: true,
        async handler(_options, _bundle) {
          if (this.environment.name !== 'ssr') {
            return;
          }

          // import server entry
          const config = this.environment.getTopLevelConfig();
          const entryPath = path.join(
            config.environments.rsc!.build.outDir,
            'index.js',
          );
          const entry: typeof import('./entry.rsc.js') = await import(
            pathToFileURL(entryPath).href
          );

          // run `handleBuild`
          unstable_getBuildOptions().unstable_phase = 'emitStaticFiles';
          const buildConfigs = await entry.handleBuild();
          for await (const buildConfig of buildConfigs || []) {
            if (buildConfig.type === 'file') {
              emitStaticFile(
                config.root,
                { distDir: 'dist' },
                buildConfig.pathname,
                buildConfig.body,
              );
            } else {
              console.warn('[waku:vite-rsc] ignored build task:', buildConfig);
            }
          }
          await waitForTasks();

          // save platform data
          const platformDataCode = `globalThis.__WAKU_SERVER_PLATFORM_DATA__ = ${JSON.stringify((globalThis as any).__WAKU_SERVER_PLATFORM_DATA__ ?? {}, null, 2)}\n`;
          const platformDataFile = path.join(
            this.environment.getTopLevelConfig().environments.rsc!.build.outDir,
            '__waku_set_platform_data.js',
          );
          fs.writeFileSync(platformDataFile, platformDataCode);
        },
      },
    },
    !!wakuFlags['with-vercel'] && wakuDeployVercelPlugin(),
  ];
}

function normalizeRelativePath(s: string) {
  s = normalizePath(s);
  return s[0] === '.' ? s : './' + s;
}

function createVirtualPlugin(name: string, load: Plugin['load']) {
  name = 'virtual:' + name;
  return {
    name: `waku:virtual-${name}`,
    resolveId(source, _importer, _options) {
      return source === name ? '\0' + name : undefined;
    },
    load(id, options) {
      if (id === '\0' + name) {
        return (load as Function).apply(this, [id, options]);
      }
    },
  } satisfies Plugin;
}
