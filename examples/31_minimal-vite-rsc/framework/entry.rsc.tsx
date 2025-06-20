import * as ReactServer from '@hiogawa/vite-rsc/rsc';
import wakuServerEntry from '../src/server-entry';

export type RscPayload = {
  elements: Record<string, unknown>;
  html?: React.ReactNode;
};

// the plugin by default assumes `rsc` entry having default export of request handler.
// however, how server entries are executed can be customized by registering
// own server handler e.g. `@cloudflare/vite-plugin`.
export default async function handler(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const isRscRequest =
    (!request.headers.get('accept')?.includes('text/html') &&
      !url.searchParams.has('__html')) ||
    url.searchParams.has('__rsc');

  const wakuResult = await wakuServerEntry.handleRequest(
    isRscRequest
      ? {
          type: 'component',
          rscPath: url.pathname,
          rscParams: {},
          req: request as any,
        }
      : { type: 'custom', pathname: url.pathname, req: request as any },

    {
      async renderRsc(elements, options) {
        // console.log('[renderRsc]', { elements, options });

        return ReactServer.renderToReadableStream<RscPayload>({ elements });
      },

      async renderHtml(elements, html, options) {
        // console.log('[renderHtml]', { elements, html, options });

        const ssrEntryModule = await import.meta.viteRsc.loadModule<
          typeof import('./entry.ssr.tsx')
        >('ssr', 'index');

        const rscStream = ReactServer.renderToReadableStream<RscPayload>({
          elements,
          html,
        });
        const htmlStream = await ssrEntryModule.renderHTML(rscStream, {
          debugNojs: url.searchParams.has('__nojs'),
        });
        return {
          body: htmlStream as any,
          headers: { 'content-type': 'text/html' },
        };
      },
    },
  );

  let response: Response;
  if (wakuResult) {
    if (wakuResult instanceof ReadableStream) {
      response = new Response(wakuResult);
    } else if (wakuResult.body) {
      response = new Response(wakuResult.body, {
        headers: {
          'content-type': 'text/html',
        },
      });
    }
  }
  response ??= new Response('[not-found]');
  return response;

  // handle server function request
  // const isAction = request.method === 'POST';
  // let returnValue: unknown | undefined;
  // let formState: ReactFormState | undefined;
  // let temporaryReferences: unknown | undefined;
  // if (isAction) {
  //   // x-rsc-action header exists when action is called via `ReactClient.setServerCallback`.
  //   const actionId = request.headers.get('x-rsc-action');
  //   if (actionId) {
  //     const contentType = request.headers.get('content-type');
  //     const body = contentType?.startsWith('multipart/form-data')
  //       ? await request.formData()
  //       : await request.text();
  //     temporaryReferences = ReactServer.createTemporaryReferenceSet();
  //     const args = await ReactServer.decodeReply(body, { temporaryReferences });
  //     const action = await ReactServer.loadServerAction(actionId);
  //     returnValue = await action.apply(null, args);
  //   } else {
  //     // otherwise server function is called via `<form action={...}>`
  //     // before hydration (e.g. when javascript is disabled).
  //     // aka progressive enhancement.
  //     const formData = await request.formData();
  //     const decodedAction = await ReactServer.decodeAction(formData);
  //     const result = await decodedAction();
  //     formState = await ReactServer.decodeFormState(result, formData);
  //   }
  // }

  // // serialization from React VDOM tree to RSC stream.
  // // we render RSC stream after handling server function request
  // // so that new render reflects updated state from server function call
  // // to achieve single round trip to mutate and fetch from server.
  // const rscStream = ReactServer.renderToReadableStream<RscPayload>({
  //   // in this example, we always render the same `<Root />`
  //   root: <Root />,
  //   returnValue,
  //   formState,
  // });

  // // respond RSC stream without HTML rendering based on framework's convention.
  // // here we use request header `content-type`.
  // // additionally we allow `?__rsc` and `?__html` to easily view payload directly.
  // const url = new URL(request.url);
  // const isRscRequest =
  //   (!request.headers.get('accept')?.includes('text/html') &&
  //     !url.searchParams.has('__html')) ||
  //   url.searchParams.has('__rsc');

  // if (isRscRequest) {
  //   return new Response(rscStream, {
  //     headers: {
  //       'content-type': 'text/x-component;charset=utf-8',
  //       vary: 'accept',
  //     },
  //   });
  // }

  // // Delegate to SSR environment for html rendering.
  // // The plugin provides `loadSsrModule` helper to allow loading SSR environment entry module
  // // in RSC environment. however this can be customized by implementing own runtime communication
  // // e.g. `@cloudflare/vite-plugin`'s service binding.
  // const ssrEntryModule = await import.meta.viteRsc.loadModule<
  //   typeof import('./entry.ssr.tsx')
  // >('ssr', 'index');
  // const htmlStream = await ssrEntryModule.renderHTML({
  //   stream: rscStream,
  //   formState,
  //   options: {
  //     // allow quick simulation of javscript disabled browser
  //     debugNojs: url.searchParams.has('__nojs'),
  //   },
  // });

  // // respond html
  // return new Response(htmlStream, {
  //   headers: {
  //     'Content-type': 'text/html',
  //     vary: 'accept',
  //   },
  // });
}
