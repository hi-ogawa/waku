import waku from 'waku/vite-rsc/plugin';
import { importMetaUrlServerPlugin } from './waku.config.js';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    waku(),
    {
      ...importMetaUrlServerPlugin(),
      apply: 'build',
      applyToEnvironment: (environment) => environment.name === 'rsc',
    },
  ],
});
