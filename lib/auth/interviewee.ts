import { SignJWT, jwtVerify } from "jose";
import { ulid } from "ulid";

/**
 * Lazy access to the JWT secret so process.env is read at first use, not at
 * module-import time. This matters because importers (Next.js, scripts) may
 * load .env after this module is first imported; if we cached the secret as a
 * top-level const, scripts and the dev server would fork onto two different
 * fallback secrets and tokens minted by one would fail verification in the
 * other.
 */
function secretBytes(): Uint8Array {
  const raw =
    process.env.JWT_SECRET ||
    "dev-only-do-not-use-in-prod-32-byte-secret-xx";
  return new TextEncoder().encode(raw);
}

const ISSUER = "ghost-writer";
const AUDIENCE = "interviewee";

export interface IntervieweeClaims {
  /** Session id this token authorizes access to. */
  sid: string;
  /** Interviewee id, denormalized for cheap UI rendering. */
  iid: string;
}

export interface SignedToken {
  jwt: string;
  jti: string;
  expiresAt: number;
}

/**
 * Sign a single-session JWT for the interviewee. Default expiry: 72 hours.
 * The session row stores `tokenJti` so revocation is just an insert into
 * `revoked_tokens` + a check on every read.
 */
export async function signIntervieweeToken(
  claims: IntervieweeClaims,
  opts: { ttlSeconds?: number } = {},
): Promise<SignedToken> {
  const ttl = opts.ttlSeconds ?? 60 * 60 * 72;
  const jti = ulid();
  const now = Math.floor(Date.now() / 1000);
  const expSeconds = now + ttl;

  const jwt = await new SignJWT({ sid: claims.sid, iid: claims.iid })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setJti(jti)
    .setIssuedAt(now)
    .setExpirationTime(expSeconds)
    .sign(secretBytes());

  return { jwt, jti, expiresAt: expSeconds * 1000 };
}

export async function verifyIntervieweeToken(
  jwt: string,
): Promise<IntervieweeClaims & { jti: string }> {
  const { payload } = await jwtVerify(jwt, secretBytes(), {
    issuer: ISSUER,
    audience: AUDIENCE,
  });
  if (typeof payload.sid !== "string" || typeof payload.iid !== "string" || typeof payload.jti !== "string") {
    throw new Error("invalid interviewee token payload");
  }
  return { sid: payload.sid, iid: payload.iid, jti: payload.jti };
}
