import { defineConfig } from "waku/config";
import { cloudflare } from "@cloudflare/vite-plugin"
// import { __fix_cloudflare } from "@hiogawa/vite-rsc/plugin";

export default defineConfig({
  vite: {
    plugins: [
      cloudflare({
        viteEnvironment: {
          name: 'rsc',
        }
      }),
      // __fix_cloudflare(),
    ],
  }
})
