import { defineConfig } from 'vite';
import rsc from '@hiogawa/vite-rsc/plugin';
import waku from 'waku-vite-rsc/plugin';

export default defineConfig({
  plugins: [waku(), rsc()],
});
