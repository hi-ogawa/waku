import { defineConfig } from 'vite';
import rsc from '@hiogawa/vite-rsc/plugin';
import react from '@vitejs/plugin-react';
import waku from 'waku-vite-rsc/plugin';

export default defineConfig({
  plugins: [react(), waku(), rsc()],
});
