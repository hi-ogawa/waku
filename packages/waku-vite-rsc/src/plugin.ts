import type { EnvironmentOptions, PluginOption } from 'vite';
import react from '@vitejs/plugin-react';
import rsc from '@hiogawa/vite-rsc/plugin';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const PKG_NAME = 'waku-vite-rsc';

export default function wakuViteRscPlugin(): PluginOption {
  return [
    react(),
    rsc(),
    {
      name: 'rsc:waku',
      config() {
        const toEnvironmentOption = (entry: string) =>
          ({
            build: {
              rollupOptions: {
                input: {
                  index: `${PKG_NAME}/${entry}`,
                },
              },
            },
          }) satisfies EnvironmentOptions;

        return {
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
            exclude: [PKG_NAME, 'waku/minimal/client', 'waku/router/client'],
          },
          build: {
            // top-level-await in packages/waku/src/lib/middleware/context.ts
            target: name !== 'client' ? 'esnext' : undefined,
          },
        };
      },
    },
    {
      // don't violate https://github.com/hi-ogawa/rsc-tests
      name: 'rsc:waku:fix-internal-client-boundary',
      transform(code, id) {
        if (id.includes('/node_modules/waku/dist/router/create-pages.js')) {
          console.log({ id });
          return code
            .replaceAll(
              `from '../minimal/client.js'`,
              `from 'waku/minimal/client'`,
            )
            .replaceAll(
              `from '../router/client.js'`,
              `from 'waku/router/client'`,
            );
        }
        if (id.includes('/node_modules/waku/dist/router/define-router.js')) {
          console.log({ id });
          return code.replaceAll(
            `from './client.js'`,
            `from 'waku/router/client'`,
          );
        }
      },
      resolveId: {
        order: 'pre',
        handler(id, importer) {
          // warning if `{minimal,router}/client.js` is internally resolved inside rsc environment
          if (
            importer?.includes('/node_modules/') &&
            id.endsWith('/client.js')
          ) {
            if (this.environment.name === 'rsc') {
              console.log(
                '[vite-rsc:waku] client boundary inside server package?',
                { id, importer },
              );
            }
          }
        },
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
      applyToEnvironment: (environment) => environment.name === 'client',
      async transform(code, id) {
        if (id.endsWith('/minimal/client.js')) {
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
