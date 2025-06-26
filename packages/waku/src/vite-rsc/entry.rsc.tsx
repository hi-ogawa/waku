/* eslint-disable */
import * as ReactServer from '@hiogawa/vite-rsc/rsc';
import type React from 'react';
import type { unstable_defineEntries } from '../minimal/server.js';
import {
  decodeFuncId,
  decodeRscPath,
  encodeRscPath,
} from '../lib/renderers/utils.js';
import { stringToStream } from '../lib/utils/stream.js';
import { INTERNAL_setAllEnv } from '../server.js';
import { joinPath } from '../lib/utils/path.js';
import { runWithContext } from '../lib/middleware/context.js';
import { getErrorInfo } from '../lib/utils/custom-errors.js';
import type {
  HandlerContext,
  Middleware,
  MiddlewareOptions,
} from '../lib/middleware/types.js';

//
// server handler entry point
//

export default async function handler(request: Request): Promise<Response> {
  INTERNAL_setAllEnv(process.env as any);

  const ctx: HandlerContext = {
    req: {
      body: request.body,
      url: new URL(request.url),
      method: request.method,
      headers: Object.fromEntries(request.headers.entries()),
    },
    res: {},
    data: {},
  };

  // TODO: nest async calls
  const middlewares = await loadMiddlewares();
  for (const middleware of middlewares) {
    let next = false;
    await middleware(ctx, async () => {
      next = true;
    });
    if (!next) {
      return new Response(ctx.res.body, {
        status: ctx.res.status ?? 200,
        headers: ctx.res.headers as any,
      });
    }
  }

  await runWithContext(ctx, () => handleRequest(request, ctx));

  if (ctx.res.body || ctx.res.status) {
    return new Response(ctx.res.body || '', {
      status: ctx.res.status ?? 200,
      headers: ctx.res.headers as any,
    });
  }

  return new Response('404 Not Found', { status: 404 });
}

let loadedMiddlewares_: ReturnType<Middleware>[] | undefined;

async function loadMiddlewares() {
  if (!loadedMiddlewares_) {
    const { middlewares } = await import('virtual:vite-rsc-waku/middlewares');
    // TODO: check if this is essential
    let middlwareOptions: MiddlewareOptions;
    if (import.meta.env.DEV) {
      middlwareOptions = {
        cmd: 'dev',
        env: {},
        unstable_onError: new Set(),
        get config(): any {
          throw new Error('unsupported');
        },
      };
    } else {
      middlwareOptions = {
        cmd: 'start',
        env: {},
        unstable_onError: new Set(),
        get loadEntries(): any {
          throw new Error('unsupported');
        },
      };
    }
    loadedMiddlewares_ = middlewares.map((m) => m(middlwareOptions));
  }
  return loadedMiddlewares_;
}

//
// Core RSC integration
//

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
  const onError = (e: unknown) => {
    if (
      e &&
      typeof e === 'object' &&
      'digest' in e &&
      typeof e.digest === 'string'
    ) {
      return e.digest;
    }
  };

  return {
    async renderRsc(elements) {
      return ReactServer.renderToReadableStream<RscElementsPayload>(elements, {
        temporaryReferences,
        onError,
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
        ReactServer.renderToReadableStream<RscElementsPayload>(elements, {
          onError,
        });

      const rscHtmlStream = ReactServer.renderToReadableStream<RscHtmlPayload>(
        html,
        { onError },
      );

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

async function handleRequest(request: Request, ctx: HandlerContext) {
  await import('virtual:vite-rsc-waku/set-platform-data');

  const wakuServerEntry = (await import('virtual:vite-rsc-waku/server-entry'))
    .default;

  // cf. packages/waku/src/lib/middleware/handler.ts `getInput`
  const url = ctx.req.url;
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
        req: ctx.req,
      };
    } else {
      // client RSC request
      let rscParams: unknown = url.searchParams;
      if (request.body) {
        const contentType = request.headers.get('content-type');
        const body = contentType?.startsWith('multipart/form-data')
          ? await request.formData()
          : await request.text();
        rscParams = await ReactServer.decodeReply(body, {
          temporaryReferences,
        });
      }
      wakuInput = {
        type: 'component',
        rscPath,
        rscParams,
        req: ctx.req,
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
        pathname: decodeURI(url.pathname),
        req: ctx.req,
      };
    } else {
      // POST API request
      wakuInput = {
        type: 'custom',
        pathname: decodeURI(url.pathname),
        req: ctx.req,
      };
    }
  } else {
    // SSR
    wakuInput = {
      type: 'custom',
      pathname: decodeURI(url.pathname),
      req: ctx.req,
    };
  }

  const implementation = createImplementation({
    temporaryReferences,
    debugNojs: url.searchParams.has('__nojs'),
  });

  let res: HandleRequestOutput;
  try {
    res = await wakuServerEntry.handleRequest(wakuInput, implementation);
  } catch (e) {
    const info = getErrorInfo(e);
    ctx.res.status = info?.status || 500;
    ctx.res.body = stringToStream(
      (e as { message?: string } | undefined)?.message || String(e),
    );
    if (info?.location) {
      (ctx.res.headers ||= {}).location = info.location;
    }
  }

  if (res instanceof ReadableStream) {
    ctx.res.body = res;
  } else if (res) {
    if (res.body) {
      ctx.res.body = res.body;
    }
    if (res.status) {
      ctx.res.status = res.status;
    }
    if (res.headers) {
      Object.assign((ctx.res.headers ||= {}), res.headers);
    }
  }

  if (!(ctx.res.body || ctx.res.status) && url.pathname === '/') {
    const ssrEntryModule = await import.meta.viteRsc.loadModule<
      typeof import('./entry.ssr.tsx')
    >('ssr', 'index');
    const htmlFallbackStream = await ssrEntryModule.renderHtmlFallback();
    ctx.res.body = htmlFallbackStream;
    ctx.res.headers = { 'content-type': 'text/html;charset=utf-8' };
  }
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
