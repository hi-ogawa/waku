import { defineConfig } from 'waku/config';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  vite: {
    plugins: [
      tailwindcss(),
      {
        // https://github.com/hi-ogawa/reproductions/tree/main/vite-rsc-fontsource
        name: 'fix-dev-font-double-flash',
        configureServer(server) {
          server.middlewares.use((req, res, next) => {
            const url = new URL(req.url || '', 'http://localhost');
            if (url.pathname.endsWith('.woff2')) {
              res.setHeader('cache-control', 'max-age=10');
            }
            next();
          });
        },
      },
    ],
    environments: {
      rsc: {
        resolve: {
          external: ['shiki'],
        },
      },
    },
  },
});
