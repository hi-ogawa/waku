# waku-vite-rsc

Experimental Waku implementation based on [Vite RSC](https://github.com/hi-ogawa/vite-plugins/tree/main/packages/rsc) API

## Usage

- `vite.config.ts`

```js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import waku from 'waku-vite-rsc/plugin';
import rsc from '@hiogawa/vite-rsc/plugin';

export default defineConfig({
  plugins: [react(), waku(), rsc()],
});
```
