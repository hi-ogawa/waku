import waku from 'waku-vite-rsc/plugin';

export default {
  plugins: [waku()],
  optimizeDeps: {
    exclude: ['ai/rsc'],
  },
};
