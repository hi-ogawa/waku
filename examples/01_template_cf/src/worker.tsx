import handler from "waku/vite-rsc/entry.rsc";

export default {
  async fetch(request: Request, env: any, ctx: any): Promise<Response> {
    // you can setup you own AsyncLocalStorage for env and ctx
    // return fetch(request, {
    //   cf: {
    //     cacheEverything: true,
    //     cacheTtl: 3600,
    //   },
    // });
    handler;
    return new Response("ok");
  }
}
