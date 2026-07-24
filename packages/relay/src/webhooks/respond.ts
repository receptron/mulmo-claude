// Outbound reply plumbing shared by the webhook platforms that deliver a
// reply as a chunked series of authenticated JSON POSTs (Messenger, WhatsApp,
// Teams). The chunk loop, the network-error wrapper, and the non-2xx detail
// message were identical copies across all three.

import { chunkText } from "@mulmobridge/client/text";
import { FIFTEEN_SECONDS_MS } from "../time.js";

const MAX_ERROR_DETAIL_CHARS = 200;

export interface PostJsonChunksInput {
  text: string;
  maxTextLength: number;
  /** Platform label prefixed onto thrown errors (e.g. "WhatsApp"). */
  label: string;
  endpoint: string;
  accessToken: string;
  buildBody: (chunk: string) => unknown;
}

// Fails closed on the first network or non-2xx error rather than continuing to
// send later chunks.
export async function postJsonChunks(input: PostJsonChunksInput): Promise<void> {
  for (const chunk of chunkText(input.text, input.maxTextLength)) {
    let res: Response;
    try {
      res = await fetch(input.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${input.accessToken}` },
        body: JSON.stringify(input.buildBody(chunk)),
        signal: AbortSignal.timeout(FIFTEEN_SECONDS_MS),
      });
    } catch (err) {
      throw new Error(`${input.label} API network error: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`${input.label} API failed: ${res.status} ${detail.slice(0, MAX_ERROR_DETAIL_CHARS)}`);
    }
  }
}
