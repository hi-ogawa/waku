import type { MiddlewareHandler } from 'hono';
import type { Handler, HandlerContext } from '../middleware/types.js';

// Internal context key
export const HONO_CONTEXT = '__hono_context';

export function handlersToHonoMiddleware(
  handlers: Handler[],
): MiddlewareHandler {
  return async (c, next) => {
    const ctx: HandlerContext = {
      req: {
        body: c.req.raw.body,
        url: new URL(c.req.url),
        method: c.req.method,
        headers: c.req.header(),
      },
      res: {},
      data: {
        [HONO_CONTEXT]: c,
      },
    };
    const run = async (index: number) => {
      if (index >= handlers.length) {
        return;
      }
      let alreadyCalled = false;
      await handlers[index]!(ctx, async () => {
        if (!alreadyCalled) {
          alreadyCalled = true;
          await run(index + 1);
        }
      });
    };
    await run(0);
    if (ctx.res.body || ctx.res.status) {
      const status = ctx.res.status || 200;
      const headers = ctx.res.headers || {};
      if (ctx.res.body) {
        return c.body(ctx.res.body, status as never, headers);
      }
      return c.body(null, status as never, headers);
    }
    await next();
  };
}

export async function runMiddlewareHandlers(
  handlers: Handler[],
  ctx: HandlerContext,
) {
  const run = async (index: number) => {
    if (index >= handlers.length) {
      return;
    }
    let alreadyCalled = false;
    await handlers[index]!(ctx, async () => {
      if (!alreadyCalled) {
        alreadyCalled = true;
        await run(index + 1);
      }
    });
  };
  await run(0);
}
