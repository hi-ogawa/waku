import { unstable_defineEntries as defineEntries } from 'waku/minimal/server';
import { Slot } from 'waku/minimal/client';

import App from './components/App';

export default defineEntries({
  handleRequest: async (input, { renderRsc, renderHtml }) => {
    if (input.type === 'component') {
      return renderRsc({ App: <App name={input.rscPath || 'Waku'} /> });
    }
    if (input.type === 'custom' && input.pathname === '/') {
      return renderHtml({ App: <App name="Waku" /> }, <Slot id="App" />, {
        rscPath: '',
      });
    }
    if (input.type === 'function') {
      const value = await input.fn(...input.args);
      return renderRsc({ App: <App name="Waku" />, _value: value });
    }
    if (input.type === 'action') {
      const actionResult = await input.fn();
      return renderHtml({ App: <App name="Waku" /> }, <Slot id="App" />, {
        rscPath: '',
        actionResult,
      });
    }
  },
  handleBuild: () => ({}) as any,
});
