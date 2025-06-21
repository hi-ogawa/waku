import * as ReactClient from '@hiogawa/vite-rsc/browser';
import { unstable_callServerRsc } from 'waku/minimal/client';
ReactClient.setServerCallback(unstable_callServerRsc);

if (import.meta.hot) {
  import.meta.hot.on('rsc:update', () => {
    (globalThis as any).__WAKU_RSC_RELOAD_LISTENERS__?.forEach((l: any) => l());
  });
}
