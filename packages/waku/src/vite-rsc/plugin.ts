import {
  normalizePath,
  type EnvironmentOptions,
  type PluginOption,
} from 'vite';
import react from '@vitejs/plugin-react';
import rsc from '@hiogawa/vite-rsc/plugin';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// TODO: refactor and reuse common plugins from lib/plugins

const PKG_NAME = 'waku';

export default function wakuViteRscPlugin(wakuOptions?: {
  serverHmr?: boolean | 'reload';
}): PluginOption {
  return [
    react(),
    rsc({
      ignoredClientInServerPackageWarning: [PKG_NAME],
    }),
    {
      name: 'rsc:waku',
      config() {
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

        return {
          define: {
            'import.meta.env.WAKU_CONFIG_BASE_PATH': JSON.stringify('/'),
            'import.meta.env.WAKU_CONFIG_RSC_BASE': JSON.stringify('RSC'),
            // TODO: it fails on router examples, so for now force reload by default
            'import.meta.env.WAKU_SERVER_HMR': JSON.stringify(
              wakuOptions?.serverHmr ?? 'reload',
            ),
          },
          environments: {
            client: toEnvironmentOption('entry.browser'),
            ssr: toEnvironmentOption('entry.ssr'),
            rsc: toEnvironmentOption('entry.rsc'),
          },
        };
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
        // cf. packages/waku/src/lib/plugins/vite-plugin-rsc-managed.ts
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
        if (wakuOptions?.serverHmr !== true) {
          return;
        }
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
        }
      },
    },
    {
      // expose `__WAKU_SERVER_PLATFORM_DATA__.fsRouterFiles` for build.
      // for now we manually crawl `src/pages/` to collect all files.
      // TODO: support `handleBuild` API.
      name: 'rsc:waku:set-platform-data',
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
      writeBundle: {
        order: 'post',
        async handler(_options, _bundle) {
          if (this.environment.name !== 'ssr') {
            return;
          }
          const { glob } = await import('tinyglobby');
          const fsRouterFiles = await glob(`**/*.{ts,tsx,js,jsx,mjs,cjs}`, {
            cwd: `src/pages/`,
          });
          const setPlatformDataCode = `\
            globalThis.__WAKU_SERVER_PLATFORM_DATA__ ??= {};
            __WAKU_SERVER_PLATFORM_DATA__.fsRouterFiles = [${JSON.stringify(fsRouterFiles)}];
          `;
          const setPlatformDataFile = path.join(
            this.environment.getTopLevelConfig().environments.rsc!.build.outDir,
            '__waku_set_platform_data.js',
          );
          fs.writeFileSync(setPlatformDataFile, setPlatformDataCode);
        },
      },
    },
  ];
}

// cf. packages/waku/src/lib/plugins/vite-plugin-rsc-managed.ts
const EXTENSIONS = ['.js', '.ts', '.tsx', '.jsx', '.mjs', '.cjs'];

const getManagedEntries = (
  filePath: string,
  srcDir: string,
  options: { pagesDir: string; apiDir: string },
) => `
import { unstable_fsRouter as fsRouter } from 'waku/router/server';

export default fsRouter(
  '${pathToFileURL(filePath)}',
  (file) => import.meta.glob('/${srcDir}/pages/**/*.{${EXTENSIONS.map((ext) =>
    ext.replace(/^\./, ''),
  ).join(',')}}')[\`/${srcDir}/pages/\${file}\`]?.(),
  { pagesDir: '${options.pagesDir}', apiDir: '${options.apiDir}' },
);
`;

const getManagedMain = () => `
import { StrictMode, createElement } from 'react';
import { createRoot, hydrateRoot } from 'react-dom/client';
import { Router } from 'waku/router/client';

const rootElement = createElement(StrictMode, null, createElement(Router));

if (globalThis.__WAKU_HYDRATE__) {
  hydrateRoot(document, rootElement);
} else {
  createRoot(document).render(rootElement);
}
`;

function normalizeRelativePath(s: string) {
  s = normalizePath(s);
  return s[0] === '.' ? s : './' + s;
}
