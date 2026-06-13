import bcrypt from "bcryptjs";
import type { Database } from "better-sqlite3";
import { createId } from "../utils/createId.js";
import { getUserById, getUserByUsername } from "./userRepository.js";
import { createSession, deleteSession, getSession } from "./sessionRepository.js";
import type { AuthUser, User } from "../../shared/types/auth.js";

const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

export async function hashPassword(password: string): Promise<string> {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(password, salt);
}

export async function comparePassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function createAuthUser(user: User): AuthUser {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
  };
}

export async function loginUser(db: Database, username: string, password: string): Promise<{ user: AuthUser; sessionId: string }> {
  const user = getUserByUsername(db, username);
  if (!user) {
    throw new Error("Invalid username or password");
  }

  const match = await comparePassword(password, user.passwordHash);
  if (!match) {
    throw new Error("Invalid username or password");
  }

  const now = new Date();
  const sessionId = createId("sess");
  const expiresAt = new Date(now.getTime() + SESSION_DURATION_MS).toISOString();

  createSession(db, {
    id: sessionId,
    userId: user.id,
    createdAt: now.toISOString(),
    expiresAt,
  });

  return { user: createAuthUser(user), sessionId };
}

export function logoutSession(db: Database, sessionId: string): void {
  deleteSession(db, sessionId);
}

export function getAuthUserFromSession(db: Database, sessionId: string): AuthUser | undefined {
  const session = getSession(db, sessionId);
  if (!session) return undefined;

  const expiresAt = new Date(session.expiresAt);
  if (expiresAt.getTime() <= Date.now()) {
    deleteSession(db, sessionId);
    return undefined;
  }

  const user = getUserById(db, session.userId);
  if (!user) return undefined;
  return createAuthUser(user);
}
