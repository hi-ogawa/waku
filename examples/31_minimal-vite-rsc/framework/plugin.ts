import type { Plugin } from 'vite';

export function rscWaku(): Plugin[] {
  return [
    {
      name: 'rsc:waku',
      config() {
        return {
          define: {
            'import.meta.env.WAKU_CONFIG_BASE_PATH': JSON.stringify('/'),
            'import.meta.env.WAKU_CONFIG_RSC_BASE': JSON.stringify('RSC'),
          },
          environments: {
            client: {
              build: {
                rollupOptions: {
                  input: {
                    index: './framework/entry.browser.tsx',
                  },
                },
              },
            },
            ssr: {
              build: {
                rollupOptions: {
                  input: {
                    index: './framework/entry.ssr.tsx',
                  },
                },
              },
            },
            rsc: {
              build: {
                rollupOptions: {
                  input: {
                    index: './framework/entry.rsc.tsx',
                  },
                },
              },
            },
          },
        };
      },
    },
    {
      name: 'rsc:waku:user-entries',
      resolveId(source, _importer, options) {
        if (source === 'virtual:vite-rsc-waku/server-entry') {
          return this.resolve('/src/server-entry', undefined, options);
        }
        if (source === 'virtual:vite-rsc-waku/client-entry') {
          return this.resolve('/src/client-entry', undefined, options);
        }
      },
    },
    {
      // rewrite `react-server-dom-webpack` in `waku/minimal/client`
      name: 'rsc:waku:patch-webpack',
      enforce: 'pre',
      resolveId(source, importer, options) {
        if (source === 'react-server-dom-webpack/client') {
          return '\0' + source;
        }
      },
      load(id) {
        if (id === '\0react-server-dom-webpack/client') {
          if (this.environment.name === 'client') {
            return `
              import * as ReactClient from '@hiogawa/vite-rsc/browser';
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
