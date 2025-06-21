import { defineConfig } from 'vite';
import rsc from '@hiogawa/vite-rsc/plugin';
import react from '@vitejs/plugin-react';
import { rscWaku } from './framework/plugin';

export default defineConfig({
  plugins: [react(), rscWaku(), rsc()],
});
