import * as ReactClient from '@hiogawa/vite-rsc/browser';
import { unstable_callServerRsc } from 'waku/minimal/client';
ReactClient.setServerCallback(unstable_callServerRsc);

if (import.meta.hot) {
  import.meta.hot.on('rsc:update', (e) => {
    console.log('[rsc:update]', e);
    if (import.meta.env.WAKU_SERVER_HMR === 'reload') {
      window.location.reload();
    }
    if (import.meta.env.WAKU_SERVER_HMR === true) {
      (globalThis as any).__WAKU_RSC_RELOAD_LISTENERS__?.forEach((l: any) =>
        l(),
      );
    }
  });
}
