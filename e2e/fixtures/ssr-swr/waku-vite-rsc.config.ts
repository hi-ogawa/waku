import waku from 'waku/vite-rsc/plugin';

export default {
  plugins: [waku()],
  environments: {
    client: {
      optimizeDeps: {
        include: ['swr'],
      },
    },
    ssr: {
      optimizeDeps: {
        include: ['swr'],
      },
    },
  },
};
