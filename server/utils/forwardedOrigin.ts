// Resolving the origin the BROWSER sees, which is not the origin the server
// was reached on once a proxy is in front.
//
// Dev puts Vite in front (it proxies `/artifacts/html` → localhost:3001 with
// `changeOrigin: true`), so the raw `Host` is the upstream socket, not what the
// browser typed. Prod without a proxy has no forwarded headers at all and the
// raw values are correct. Both cases go through the same fallback chain.

/** The slice of an Express `Request` this needs — a header reader and the
 *  protocol. Narrow so a test can hand it a literal instead of a socket. */
export interface OriginSource {
  get: (name: string) => string | undefined;
  protocol: string;
}

/** `X-Forwarded-*` values can be a comma-separated proxy chain, each hop
 *  appending its own value. Only the outermost hop — the value the browser
 *  actually sees — is wanted. Without this a multi-hop deployment emits
 *  `https://a.example.com, b.example.com://x`, which breaks preview
 *  subresource loading at the browser (#1056 review). */
export function firstForwardedValue(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const first = raw.split(",")[0]?.trim();
  return first && first.length > 0 ? first : undefined;
}

/** The `<proto>://<host>` a browser would use to reach this request, honouring
 *  a proxy's `X-Forwarded-*` when present and falling back to the raw socket
 *  values when it is not. */
export function browserVisibleOrigin(req: OriginSource): string {
  const fwdHost = firstForwardedValue(req.get("x-forwarded-host"));
  const fwdProto = firstForwardedValue(req.get("x-forwarded-proto"));
  const host = fwdHost ?? req.get("host");
  const proto = fwdProto ?? req.protocol;
  return `${proto}://${host}`;
}
