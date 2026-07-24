// Shared Bearer-JWT parsing + RSA signature verification for the webhook
// platforms that authenticate inbound requests with a JWT (Google Chat,
// Microsoft Teams). These were byte-identical copies across both files and
// sit on the auth boundary, so a single source keeps a hardening fix from
// having to be applied twice. Each platform still owns its own claim
// validation and JWKS fetch/cache — only the parse and the crypto.subtle
// signature check live here.

export interface ParsedJwt {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
  signInput: string;
  sig: Uint8Array;
}

// Minimal RSA JWK public-key shape that crypto.subtle.importKey accepts —
// each platform's own JWKS entry (which may carry extra fields such as Teams'
// `endorsements`) is structurally assignable to this.
export interface JwkPublicKey {
  kty: string;
  n: string;
  e: string;
  alg?: string;
  kid?: string;
}

export function b64UrlDecode(str: string): Uint8Array {
  // Restore the standard-alphabet chars and the `=` padding that base64url
  // omits before atob, which only accepts padded standard base64.
  const padded = str
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(str.length + ((4 - (str.length % 4)) % 4), "=");
  return Uint8Array.from(atob(padded), (chr) => chr.charCodeAt(0));
}

// null means "not a well-formed JWT" — callers treat that as a rejection.
export function parseJwt(token: string): ParsedJwt | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const header = JSON.parse(new TextDecoder().decode(b64UrlDecode(parts[0]))) as Record<string, unknown>;
    const payload = JSON.parse(new TextDecoder().decode(b64UrlDecode(parts[1]))) as Record<string, unknown>;
    return { header, payload, signInput: `${parts[0]}.${parts[1]}`, sig: b64UrlDecode(parts[2]) };
  } catch {
    return null;
  }
}

export function jwtKid(jwt: ParsedJwt): string {
  return typeof jwt.header.kid === "string" ? jwt.header.kid : "";
}

export function jwtHashAlg(jwt: ParsedJwt): "SHA-256" | "SHA-384" | "SHA-512" {
  const alg = typeof jwt.header.alg === "string" ? jwt.header.alg : "RS256";
  if (alg === "RS256") return "SHA-256";
  if (alg === "RS384") return "SHA-384";
  // Any other value falls through to SHA-512, preserving the original inline
  // ternary in both callers.
  return "SHA-512";
}

// The caller must have already validated the claims and selected `jwk` by kid.
export async function verifyJwtSignature(jwt: ParsedJwt, jwk: JwkPublicKey): Promise<boolean> {
  const pubKey = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: jwtHashAlg(jwt) }, false, ["verify"]);
  return crypto.subtle.verify("RSASSA-PKCS1-v1_5", pubKey, jwt.sig, new TextEncoder().encode(jwt.signInput));
}
