import { StrictMode } from 'react';
import { createRoot, hydrateRoot } from 'react-dom/client';
import { Root, Slot, unstable_callServerRsc } from 'waku/minimal/client';
import * as ReactClient from '@hiogawa/vite-rsc/browser';

ReactClient.setServerCallback(unstable_callServerRsc);

const rootElement = (
  <StrictMode>
    <Root>
      <Slot id="App" />
    </Root>
  </StrictMode>
);

if ((globalThis as any).__WAKU_HYDRATE__) {
  hydrateRoot(document, rootElement);
} else {
  createRoot(document as any).render(rootElement);
}

if (import.meta.hot) {
  import.meta.hot.on('rsc:update', () => {
    // TODO
  });
}
