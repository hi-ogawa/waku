import { defineConfig } from 'waku/config';
import { cloudflare } from '@cloudflare/vite-plugin';

export default defineConfig({
  vite: {
    plugins: [
      cloudflare({
        viteEnvironment: {
          name: 'rsc',
        },
      }),
      {
        name: 'waku-cf-wip',
        config(config) {
          config;
        },
      },
    ],
  },
});
