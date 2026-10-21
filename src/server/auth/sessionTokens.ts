import { createHash, randomBytes } from "node:crypto";

// OWASP Session Management: custom session IDs need a CSPRNG and >=128 random bits.
// Use 32 bytes (256 random bits); hex encoding and hashing do not add entropy.
// https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html#session-id-content-or-value
const SESSION_TOKEN_BYTES = 32;
const SESSION_TOKEN_PATTERN = /^[0-9a-f]{64}$/;

export function createSessionToken(): string {
  return randomBytes(SESSION_TOKEN_BYTES).toString("hex");
}

export function getSessionTokenHash(token: string): string | undefined {
  // Reject legacy short IDs and malformed cookies before querying the session store.
  if (token.length !== SESSION_TOKEN_BYTES * 2 || !SESSION_TOKEN_PATTERN.test(token)) return undefined;
  // OWASP Server-Side Session Token Storage: keep a one-way verifier, not a replayable token.
  // SHA-256 is suitable here because the input is already a high-entropy random secret.
  // https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html#server-side-session-token-storage
  return createHash("sha256").update(token, "ascii").digest("hex");
}
