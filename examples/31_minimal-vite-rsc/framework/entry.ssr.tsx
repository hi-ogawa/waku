import bootstrapScriptContent from 'virtual:vite-rsc/bootstrap-script-content';
import { injectRscStreamToHtml } from '@hiogawa/vite-rsc/rsc-html-stream/ssr'; // helper API
import * as ReactClient from '@hiogawa/vite-rsc/ssr'; // RSC API
import React from 'react';
import type { ReactFormState } from 'react-dom/client';
import * as ReactDOMServer from 'react-dom/server.edge';
import type { RscPayload } from './entry.rsc';
import { INTERNAL_ServerRoot } from 'waku/minimal/client';

export async function renderHTML(
  rscStream: ReadableStream<Uint8Array>,
  options?: {
    formState?: ReactFormState;
    nonce?: string;
    debugNojs?: boolean;
  },
) {
  // duplicate one RSC stream into two.
  // - one for SSR (ReactClient.createFromReadableStream below)
  // - another for browser hydration payload by injecting <script>...FLIGHT_DATA...</script>.
  const [stream1, stream2] = rscStream.tee();

  // deserialize RSC stream back to React VDOM
  let payload: Promise<RscPayload>;
  let elementsPromise: Promise<RscPayload['elements']>;

  function SsrRoot() {
    // deserialization needs to be kicked off inside ReactDOMServer context
    // for ReactDomServer preinit/preloading to work
    payload ??= ReactClient.createFromReadableStream<RscPayload>(stream1);
    const resolved = React.use(payload);
    elementsPromise ??= Promise.resolve(resolved.elements);
    return (
      <INTERNAL_ServerRoot elementsPromise={elementsPromise}>
        {resolved.html}
      </INTERNAL_ServerRoot>
    );
  }

  // render html (traditional SSR)
  const htmlStream = await ReactDOMServer.renderToReadableStream(<SsrRoot />, {
    bootstrapScriptContent: options?.debugNojs
      ? undefined
      : bootstrapScriptContent,
    nonce: options?.nonce,
    // no types
    ...{ formState: options?.formState },
  });

  let responseStream: ReadableStream = htmlStream;
  if (!options?.debugNojs) {
    // initial RSC stream is injected in HTML stream as <script>...FLIGHT_DATA...</script>
    responseStream = responseStream.pipeThrough(
      injectRscStreamToHtml(stream2, {
        nonce: options?.nonce,
      }),
    );
  }

  return responseStream;
}
