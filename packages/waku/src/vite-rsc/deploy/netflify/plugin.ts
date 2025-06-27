import { type Plugin } from 'vite';
import type { Config } from '../../../config.js';

export function wakuDeployNetlifyPlugin(deployOptions: {
  wakuConfig: Required<Config>;
  serverless: boolean;
}): Plugin {
  return {
    name: 'waku:deploy-netlify',
    config() {
      return {
        environments: {
          rsc: {
            build: {
              rollupOptions: {
                input: {
                  index: 'waku/vite-rsc/deploy/netlify/entry',
                },
              },
            },
          },
        },
      };
    },
    writeBundle: {
      order: 'post',
      sequential: true,
      async handler() {
        if (this.environment.name !== 'ssr') {
          return;
        }
        const config = this.environment.getTopLevelConfig();
        config.root;
        deployOptions.wakuConfig;
      },
    },
  };
}
