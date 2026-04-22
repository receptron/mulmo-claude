// Pure validators extracted from teams.ts so they can be unit-tested
// without stubbing crypto.subtle or signing fake JWTs.
//
// Implements three security checks that protect against SSRF and
// impersonation in the Teams webhook path:
//
//   1. `serviceurl` JWT claim MUST equal activity.serviceUrl
//      (otherwise an attacker with a valid token could point replies —
//       which carry our Bearer token — at an attacker-controlled URL).
//   2. `activity.channelId` MUST be "msteams"
//      (prevents impersonation from other Bot Framework channels).
//   3. Key used to sign the JWT MUST be endorsed for `msteams`
//      (MultiTenant only — the Bot Framework JWKS publishes
//       per-channel endorsements; SingleTenant AAD JWKS does not).
//
// Items 1 and 2 come from Bot Framework security guidance:
// https://learn.microsoft.com/en-us/azure/bot-service/rest-api/bot-framework-rest-connector-authentication

export const TEAMS_CHANNEL_ID = "msteams";

export type AppType = "MultiTenant" | "SingleTenant";

export interface TeamsActivityClaims {
  serviceUrl: string;
  channelId: string;
}

export interface JwkWithEndorsements {
  endorsements?: string[];
}

function normalizeUrl(url: string): string {
  return url.trim().replace(/\/$/, "");
}

export interface ValidateTokenClaimsInput {
  payload: Record<string, unknown>;
  appId: string;
  expectedIssuer: string;
  nowSeconds: number;
  activity: TeamsActivityClaims;
}

// Returns true only if every required claim lines up with the server's
// expectations AND with the activity body. Leaves signature verification
// and JWKS lookup to the caller.
export function validateTokenClaims(input: ValidateTokenClaimsInput): boolean {
  const { payload, appId, expectedIssuer, nowSeconds, activity } = input;

  if (payload.iss !== expectedIssuer) return false;

  const aud = payload.aud;
  const audMatches = typeof aud === "string" ? aud === appId : Array.isArray(aud) && aud.includes(appId);
  if (!audMatches) return false;

  // Fail closed: a missing or non-numeric `exp` is not a reason to pass.
  // (Previous version of this check read "exp === number AND expired" which
  // silently accepted tokens with no exp claim at all.)
  if (typeof payload.exp !== "number" || payload.exp < nowSeconds) return false;

  // Bot Framework tokens carry the activity's serviceUrl as the
  // `serviceurl` claim (lowercase). Require it to be present AND match —
  // a missing claim is suspicious, not a reason to pass.
  if (typeof payload.serviceurl !== "string") return false;
  if (normalizeUrl(payload.serviceurl) !== normalizeUrl(activity.serviceUrl)) return false;

  if (activity.channelId !== TEAMS_CHANNEL_ID) return false;

  return true;
}

// MultiTenant: the Bot Framework JWKS includes per-key `endorsements`
// listing the channels the key is valid for. Teams keys have
// "msteams". If the array is absent, reject.
//
// SingleTenant: the AAD JWKS does not publish endorsements; trust comes
// from the tenant-pinned issuer, so skip this check.
export function validateJwkEndorsement(jwk: JwkWithEndorsements, appType: AppType): boolean {
  if (appType === "SingleTenant") return true;
  if (!Array.isArray(jwk.endorsements)) return false;
  return jwk.endorsements.includes(TEAMS_CHANNEL_ID);
}

export interface AllowlistCheckInput {
  allowed: Set<string>;
  senderAadObjectId: string;
}

// Fail-closed allowlist: if an allowlist is configured, the sender MUST
// present an aadObjectId that is on the list. A missing aadObjectId is
// not a free pass.
export function isAllowedSender(input: AllowlistCheckInput): boolean {
  const { allowed, senderAadObjectId } = input;
  if (allowed.size === 0) return true;
  if (!senderAadObjectId) return false;
  return allowed.has(senderAadObjectId);
}
