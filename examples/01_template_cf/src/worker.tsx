import handler from 'waku/vite-rsc/entry.rsc';

export default {
  async fetch(request: Request, env: any, ctx: any): Promise<Response> {
    // you can setup you own AsyncLocalStorage to expose env and ctx
    handler;
    return new Response('ok');
  },
};
