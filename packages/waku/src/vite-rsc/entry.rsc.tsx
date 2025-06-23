import * as ReactServer from '@hiogawa/vite-rsc/rsc';
import type React from 'react';
import type { unstable_defineEntries } from '../minimal/server.js';
import { decodeFuncId, decodeRscPath } from '../lib/renderers/utils.js';
import type { HandlerReq, HandlerRes } from '../lib/types.js';

// TODO: refactor common logic from packages/waku/src/lib/middleware/handler.ts

export type RscElementsPayload = Record<string, unknown>;
// eslint-disable-next-line
export type RscHtmlPayload = React.ReactNode;

type WakuServerEntry = ReturnType<typeof unstable_defineEntries>;
type HandleRequestInput = Parameters<WakuServerEntry['handleRequest']>[0];
type HandleRequestImplementation = Parameters<
  WakuServerEntry['handleRequest']
>[1];

// cf. packages/waku/src/lib/middleware/handler.ts `handler`
export default async function handler(request: Request): Promise<Response> {
  // eslint-disable-next-line
  await import('virtual:vite-rsc-waku/set-platform-data');

  // eslint-disable-next-line
  const wakuServerEntry = (await import('virtual:vite-rsc-waku/server-entry'))
    .default;

  const url = new URL(request.url);
  const req: HandlerReq = {
    body: request.body,
    url,
    method: request.method,
    headers: Object.fromEntries(request.headers.entries()),
  };

  // cf. packages/waku/src/lib/middleware/handler.ts `getInput`
  const rscPathPrefix =
    import.meta.env.WAKU_CONFIG_BASE_PATH +
    import.meta.env.WAKU_CONFIG_RSC_BASE +
    '/';
  let rscPath: string | undefined;
  let temporaryReferences: unknown | undefined;
  let wakuInput: HandleRequestInput;
  if (url.pathname.startsWith(rscPathPrefix)) {
    rscPath = decodeRscPath(
      decodeURI(url.pathname.slice(rscPathPrefix.length)),
    );
    // server action: js
    const actionId = decodeFuncId(rscPath);
    if (actionId) {
      const contentType = request.headers.get('content-type');
      const body = contentType?.startsWith('multipart/form-data')
        ? await request.formData()
        : await request.text();
      temporaryReferences = ReactServer.createTemporaryReferenceSet();
      const args = await ReactServer.decodeReply(body, { temporaryReferences });
      const action = await ReactServer.loadServerAction(actionId);
      wakuInput = {
        type: 'function',
        fn: action as any,
        args,
        req,
      };
    } else {
      // client RSC request
      wakuInput = {
        type: 'component',
        rscPath,
        rscParams: url.searchParams,
        req,
      };
    }
  } else if (request.method === 'POST') {
    // cf. packages/waku/src/lib/renderers/rsc.ts `decodePostAction`
    const contentType = request.headers.get('content-type');
    if (
      typeof contentType === 'string' &&
      contentType.startsWith('multipart/form-data')
    ) {
      // server action: no js (progressive enhancement)
      const formData = await request.formData();
      const decodedAction = await ReactServer.decodeAction(formData);
      wakuInput = {
        type: 'action',
        fn: async () => {
          const result = await decodedAction();
          return await ReactServer.decodeFormState(result, formData);
        },
        pathname: url.pathname,
        req,
      };
    } else {
      // POST API request
      wakuInput = {
        type: 'custom',
        pathname: url.pathname,
        req,
      };
    }
  } else {
    // SSR
    wakuInput = {
      type: 'custom',
      pathname: url.pathname,
      req,
    };
  }

  const implementation: HandleRequestImplementation = {
    // TODO: what `options` for?
    async renderRsc(elements, _options) {
      return ReactServer.renderToReadableStream<RscElementsPayload>(elements, {
        temporaryReferences,
      });
    },
    async renderHtml(
      elements,
      html,
      options?: { rscPath?: string; actionResult?: any },
    ) {
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
          formState: options?.actionResult,
          rscPath: options?.rscPath,
        },
      );
      return {
        body: htmlStream as any,
        headers: { 'content-type': 'text/html' },
      };
    },
  };

  const wakuResult = await wakuServerEntry.handleRequest(
    wakuInput,
    implementation,
  );

  const res: HandlerRes = {};
  if (wakuResult instanceof ReadableStream) {
    res.body = wakuResult;
  } else if (wakuResult) {
    if (wakuResult.body) {
      res.body = wakuResult.body;
    }
    if (wakuResult.status) {
      res.status = wakuResult.status;
    }
    if (wakuResult.headers) {
      Object.assign((res.headers ||= {}), wakuResult.headers);
    }
  }
  if (res.body || res.status) {
    return new Response(res.body || '', {
      status: res.status || 200,
      headers: res.headers as any,
    });
  }

  if (url.pathname === '/') {
    const ssrEntryModule = await import.meta.viteRsc.loadModule<
      typeof import('./entry.ssr.tsx')
    >('ssr', 'index');
    const htmlFallbackStream = await ssrEntryModule.renderHtmlFallback();
    return new Response(htmlFallbackStream, {
      headers: {
        'content-type': 'text/html;charset=utf-8',
      },
    });
  }

  return new Response('404 Not Found', { status: 404 });
}
