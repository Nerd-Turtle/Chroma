import type { Database } from "better-sqlite3";
import type { AuthUser, UserRecord } from "../../shared/types/index.js";
import { hashPassword, passwordNeedsRehash, verifyPassword, verifyUnknownUserPassword } from "./passwords.js";
import { deleteSessionById, getSessionById, insertSession, recordSessionActivity } from "./sessionRepository.js";
import { getSessionIdleTimeoutMinutes } from "./sessionPolicy.js";
import { createSessionToken, getSessionTokenHash } from "./sessionTokens.js";
import { getUserById, getUserByUsername, updateUserPasswordHash } from "./userRepository.js";

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export class InvalidCredentialsError extends Error {
  constructor() { super("Invalid username or password"); }
}

export const SESSION_COOKIE_NAME = "chroma_session";

function toAuthUser(user: UserRecord): AuthUser {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
  };
}

export async function loginWithPassword(
  db: Database,
  username: string,
  password: string,
): Promise<{ user: AuthUser; sessionToken: string; expiresAt: Date }> {
  const user = getUserByUsername(db, username);
  if (!user) {
    await verifyUnknownUserPassword(password);
    throw new InvalidCredentialsError();
  }

  const passwordMatches = await verifyPassword(password, user.passwordHash);
  if (!passwordMatches) {
    throw new InvalidCredentialsError();
  }

  if (passwordNeedsRehash(user.passwordHash)) {
    // OWASP Password Storage / Upgrading the Work Factor: rehash only after verification.
    // A conditional write cannot overwrite a password changed while scrypt was running.
    // https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html#upgrading-the-work-factor
    updateUserPasswordHash(db, user.id, user.passwordHash, await hashPassword(password));
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  const sessionToken = createSessionToken();

  insertSession(db, {
    // The browser receives the token; SQLite keeps only its one-way verifier.
    id: getSessionTokenHash(sessionToken)!,
    userId: user.id,
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    lastActivityAt: now.toISOString(),
  });

  return {
    user: toAuthUser(user),
    sessionToken,
    expiresAt,
  };
}

export function logoutSession(db: Database, sessionToken: string): void {
  const sessionHash = getSessionTokenHash(sessionToken);
  if (sessionHash) deleteSessionById(db, sessionHash);
}

export function getAuthenticatedUser(db: Database, sessionToken: string, activity = false): AuthUser | undefined {
  const sessionHash = getSessionTokenHash(sessionToken);
  if (!sessionHash) return undefined;
  const session = getSessionById(db, sessionHash);
  if (!session) {
    return undefined;
  }

  const now = Date.now();
  const absoluteExpiry = Date.parse(session.expiresAt);
  const lastActivity = Date.parse(session.lastActivityAt);
  // OWASP Session Management / Idle Timeout: enforce both deadlines server-side, before
  // renewing activity. Polling, SSE and session inspection do not count as user activity.
  // https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html#idle-timeout
  if (!Number.isFinite(absoluteExpiry) || !Number.isFinite(lastActivity) || lastActivity > now ||
    absoluteExpiry <= now || lastActivity + getSessionIdleTimeoutMinutes(db) * 60_000 <= now) {
    deleteSessionById(db, sessionHash);
    return undefined;
  }

  const user = getUserById(db, session.userId);
  if (user && activity) recordSessionActivity(db, sessionHash, new Date(now).toISOString());
  return user ? toAuthUser(user) : undefined;
}
