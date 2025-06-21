import { defineConfig } from 'vite';
import waku from 'waku-vite-rsc/plugin';

export default defineConfig({
  plugins: [waku()],
});
