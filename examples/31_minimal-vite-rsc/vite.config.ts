import { defineConfig } from 'vite';
import rsc from '@hiogawa/vite-rsc/plugin';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [
    react(),
    rsc({
      entries: {
        // client: './framework/entry.browser.tsx',
        client: './src/client-entry.tsx',
        ssr: './framework/entry.ssr.tsx',
        rsc: './framework/entry.rsc.tsx',
      },
    }),
    {
      name: 'waku-wip',
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
  ],
});
