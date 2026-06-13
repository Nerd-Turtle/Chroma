import type { Database } from "better-sqlite3";
import type { AuthUser, UserRecord } from "../../shared/types/index.js";
import { createId } from "../utils/createId.js";
import { verifyPassword } from "./passwords.js";
import { deleteSessionById, getSessionById, insertSession } from "./sessionRepository.js";
import { getUserById, getUserByUsername } from "./userRepository.js";

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

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
): Promise<{ user: AuthUser; sessionId: string; expiresAt: Date }> {
  const user = getUserByUsername(db, username);
  if (!user) {
    throw new Error("Invalid username or password");
  }

  const passwordMatches = await verifyPassword(password, user.passwordHash);
  if (!passwordMatches) {
    throw new Error("Invalid username or password");
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  const sessionId = createId("sess");

  insertSession(db, {
    id: sessionId,
    userId: user.id,
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  });

  return {
    user: toAuthUser(user),
    sessionId,
    expiresAt,
  };
}

export function logoutSession(db: Database, sessionId: string): void {
  deleteSessionById(db, sessionId);
}

export function getAuthenticatedUser(db: Database, sessionId: string): AuthUser | undefined {
  const session = getSessionById(db, sessionId);
  if (!session) {
    return undefined;
  }

  if (Date.parse(session.expiresAt) <= Date.now()) {
    deleteSessionById(db, sessionId);
    return undefined;
  }

  const user = getUserById(db, session.userId);
  return user ? toAuthUser(user) : undefined;
}
