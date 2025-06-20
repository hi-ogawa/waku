import { defineConfig } from 'vite';
import rsc from '@hiogawa/vite-rsc/plugin';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [
    react(),
    rsc({
      entries: {
        client: './framework/entry.browser.tsx',
        ssr: './framework/entry.ssr.tsx',
        rsc: './framework/entry.rsc.tsx',
      },
    }),
  ],
});
