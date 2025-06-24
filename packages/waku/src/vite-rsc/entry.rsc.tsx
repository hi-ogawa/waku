/* eslint-disable */
import * as ReactServer from '@hiogawa/vite-rsc/rsc';
import type React from 'react';
import type { unstable_defineEntries } from '../minimal/server.js';
import {
  decodeFuncId,
  decodeRscPath,
  encodeRscPath,
} from '../lib/renderers/utils.js';
import type { HandlerReq, HandlerRes } from '../lib/types.js';
import { stringToStream } from '../lib/utils/stream.js';
import { INTERNAL_setAllEnv } from '../server.js';
import { joinPath } from '../lib/utils/path.js';
import { runWithContext } from '../lib/middleware/context.js';
import { getErrorInfo } from '../lib/utils/custom-errors.js';

// TODO: refactor common logic from packages/waku/src/lib/middleware/handler.ts

export type RscElementsPayload = Record<string, unknown>;
export type RscHtmlPayload = React.ReactNode;

type WakuServerEntry = ReturnType<typeof unstable_defineEntries>;
type HandleRequestInput = Parameters<WakuServerEntry['handleRequest']>[0];
type HandleRequestOutput = Awaited<
  ReturnType<WakuServerEntry['handleRequest']>
>;
type HandleRequestImplementation = Parameters<
  WakuServerEntry['handleRequest']
>[1];

// core RSC/HTML rendering implementation
function createImplementation({
  temporaryReferences,
  debugNojs,
}: {
  temporaryReferences?: unknown;
  debugNojs?: boolean;
}): HandleRequestImplementation {
  return {
    async renderRsc(elements) {
      return ReactServer.renderToReadableStream<RscElementsPayload>(elements, {
        temporaryReferences,
        onError: (e: unknown) => {
          if (
            e &&
            typeof e === 'object' &&
            'digest' in e &&
            typeof e.digest === 'string'
          ) {
            return e.digest;
          }
        },
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
          debugNojs,
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
}

// cf. packages/waku/src/lib/middleware/handler.ts `handler`
export default async function handler(request: Request): Promise<Response> {
  await import('virtual:vite-rsc-waku/set-platform-data');

  INTERNAL_setAllEnv(process.env as any);
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
      let rscParams: unknown;
      if (request.method === 'POST' && request.body) {
        // TODO: refetch with params?
        rscParams = await request.json();
      }
      wakuInput = {
        type: 'component',
        rscPath,
        rscParams: rscParams ?? url.searchParams,
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

  const implementation = createImplementation({
    temporaryReferences,
    debugNojs: url.searchParams.has('__nojs'),
  });

  let wakuResult: HandleRequestOutput;
  const res: HandlerRes = {};
  try {
    wakuResult = await runWithContext({ req, data: {} }, () =>
      wakuServerEntry.handleRequest(wakuInput, implementation),
    );
  } catch (e) {
    const info = getErrorInfo(e);
    res.status = info?.status || 500;
    res.body = stringToStream(
      (e as { message?: string } | undefined)?.message || String(e),
    );
    if (info?.location) {
      (res.headers ||= {}).location = info.location;
    }
  }

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

export async function handleBuild() {
  INTERNAL_setAllEnv(process.env as any);
  const wakuServerEntry = (await import('virtual:vite-rsc-waku/server-entry'))
    .default;

  const implementation = createImplementation({});

  const buidlResult = wakuServerEntry.handleBuild({
    renderRsc: implementation.renderRsc,
    renderHtml: implementation.renderHtml,
    rscPath2pathname: (rscPath) => {
      0 && console.log('[rscPath2pathname]', { rscPath });
      return joinPath(
        import.meta.env.WAKU_CONFIG_RSC_BASE,
        encodeRscPath(rscPath),
      );
    },
    unstable_collectClientModules: async (elements) => {
      0 && console.log('[unstable_collectClientModules]', { elements });
      return [];
    },
    unstable_generatePrefetchCode: (rscPaths, moduleIds) => {
      0 &&
        console.log('[unstable_generatePrefetchCode]', { rscPaths, moduleIds });
      return '';
    },
  });

  return buidlResult;
}
