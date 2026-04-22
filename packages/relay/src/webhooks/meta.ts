// Shared helpers for Meta platform webhooks (WhatsApp, Messenger).
// Both use the same x-hub-signature-256 HMAC and hub.challenge verification.

export async function verifyMetaSignature(secret: string, body: string, signature: string): Promise<boolean> {
  if (!signature.startsWith("sha256=")) return false;
  const provided = signature.slice("sha256=".length);
  if (!provided) return false;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sigBytes = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  const expected = Array.from(new Uint8Array(sigBytes))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  if (expected.length !== provided.length) return false;
  let diff = 0;
  for (let idx = 0; idx < expected.length; idx++) {
    diff |= expected.charCodeAt(idx) ^ provided.charCodeAt(idx);
  }
  return diff === 0;
}

export function handleMetaVerification(request: Request, verifyToken: string): Response {
  // Reject unconfigured deployments — an empty verify token would otherwise
  // match an empty `hub.verify_token` query param and leak the challenge echo.
  if (!verifyToken) return new Response("Forbidden", { status: 403 });
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  if (mode === "subscribe" && token === verifyToken) {
    return new Response(challenge ?? "", { status: 200 });
  }
  return new Response("Forbidden", { status: 403 });
}
