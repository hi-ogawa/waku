import { type Plugin } from 'vite';
import type { Config } from '../../../config.js';

export function wakuDeployCloudflarePlugin(deployOptions: {
  wakuConfig: Required<Config>;
}): Plugin {
  return {
    name: 'waku:deploy-cloudflare',
    config() {
      return {
        environments: {
          rsc: {
            build: {
              rollupOptions: {
                input: {
                  index: 'waku/vite-rsc/deploy/cloudflare/entry',
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
