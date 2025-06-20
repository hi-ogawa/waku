import * as ReactServer from '@hiogawa/vite-rsc/rsc';
import wakuServerEntry from '../src/server-entry';

export type RscElementsPayload = Record<string, unknown>;
export type RscHtmlPayload = React.ReactNode;

type HandleRequestInput = Parameters<
  (typeof wakuServerEntry)['handleRequest']
>[0];

type HandleRequestImplementation = Parameters<
  (typeof wakuServerEntry)['handleRequest']
>[1];

type HandleReq = {
  body: ReadableStream | null;
  url: URL;
  method: string;
  headers: Readonly<Record<string, string>>;
};

export default async function handler(request: Request): Promise<Response> {
  // cf. packages/waku/src/lib/middleware/handler.ts `handler`

  const url = new URL(request.url);
  const req: HandleReq = {
    body: request.body,
    url,
    method: request.method,
    headers: Object.fromEntries(request.headers.entries()),
  };

  // TODO: `getInput`
  const isRscRequest =
    (!request.headers.get('accept')?.includes('text/html') &&
      !url.searchParams.has('__html')) ||
    url.searchParams.has('__rsc');

  // cf. packages/waku/src/lib/renderers/utils.ts `encodeFuncId`
  // TODO: decode rscPath
  // TODO: progressive enhancement
  let temporaryReferences: unknown | undefined;
  let returnValue: unknown | undefined;
  if (url.pathname.startsWith('/F/')) {
    // /F/_<id>/<name>.txt  ==>  <id>#<name
    const actionId = url.pathname
      .slice(3, -4)
      .replace(/\/([^\/]+)$/, '#$1')
      .replace(/^_/, '');
    const contentType = request.headers.get('content-type');
    const body = contentType?.startsWith('multipart/form-data')
      ? await request.formData()
      : await request.text();
    temporaryReferences = ReactServer.createTemporaryReferenceSet();
    const args = await ReactServer.decodeReply(body, { temporaryReferences });
    const action = await ReactServer.loadServerAction(actionId);
    returnValue = await action.apply(null, args);
  }

  const input: HandleRequestInput = isRscRequest
    ? {
        type: 'component',
        rscPath: url.pathname,
        rscParams: {},
        req,
      }
    : { type: 'custom', pathname: url.pathname, req };

  const implementation: HandleRequestImplementation = {
    async renderRsc(elements, options) {
      return ReactServer.renderToReadableStream<RscElementsPayload>(elements);
    },
    async renderHtml(elements, html, options) {
      const ssrEntryModule = await import.meta.viteRsc.loadModule<
        typeof import('./entry.ssr.tsx')
      >('ssr', 'index');

      const rscElementsStream =
        ReactServer.renderToReadableStream<RscElementsPayload>(elements);

      const rscHtmlStream =
        ReactServer.renderToReadableStream<RscHtmlPayload>(html);

      const htmlStream = await ssrEntryModule.renderHTML(
        rscElementsStream,
        rscHtmlStream,
        {
          debugNojs: url.searchParams.has('__nojs'),
        },
      );
      return {
        body: htmlStream as any,
        headers: { 'content-type': 'text/html' },
      };
    },
  };

  const wakuResult = await wakuServerEntry.handleRequest(input, implementation);

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
}
