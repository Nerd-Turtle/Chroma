import { createHash, randomBytes } from "node:crypto";

const SESSION_TOKEN_BYTES = 32; // 256 random bits; hex encoding preserves all of them.
const SESSION_TOKEN_PATTERN = /^[0-9a-f]{64}$/;

export function createSessionToken(): string {
  return randomBytes(SESSION_TOKEN_BYTES).toString("hex");
}

export function getSessionTokenHash(token: string): string | undefined {
  // Reject legacy short IDs and malformed cookies before querying the session store.
  if (token.length !== SESSION_TOKEN_BYTES * 2 || !SESSION_TOKEN_PATTERN.test(token)) return undefined;
  return createHash("sha256").update(token, "ascii").digest("hex");
}
