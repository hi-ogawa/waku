import { type Plugin } from 'vite';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Config } from '../../../config.js';

const SERVE_JS = 'serve-aws-lambda.js';

export function wakuDeployAwsLambdaPlugin(deployOptions: {
  wakuConfig: Required<Config>;
}): Plugin {
  return {
    name: 'waku:deploy-aws-lambda',
    config() {
      return {
        define: {
          'import.meta.env.WAKU_SERVE_STATIC': JSON.stringify(true),
        },
        environments: {
          rsc: {
            build: {
              rollupOptions: {
                input: {
                  index: 'waku/vite-rsc/deploy/aws-lambda/entry',
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
        const opts = deployOptions.wakuConfig;
        writeFileSync(
          path.join(opts.distDir, SERVE_JS),
          `export { default } from './rsc/index.js';\n`,
        );
        writeFileSync(
          path.join(opts.distDir, 'package.json'),
          JSON.stringify({ type: 'module' }, null, 2),
        );
      },
    },
  };
}
