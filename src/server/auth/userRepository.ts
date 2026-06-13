import type { Database } from "better-sqlite3";
import type { User } from "../../shared/types/auth.js";

function mapRow(row: any): User {
  return {
    id: row.id,
    username: row.username,
    passwordHash: row.password_hash,
    role: row.role,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getUserById(db: Database, userId: string): User | undefined {
  const row = db
    .prepare(`SELECT * FROM users WHERE id = ?`)
    .get([userId]);

  if (!row) return undefined;
  return mapRow(row);
}

export function getUserByUsername(db: Database, username: string): User | undefined {
  const row = db
    .prepare(`SELECT * FROM users WHERE username = ?`)
    .get([username]);

  if (!row) return undefined;
  return mapRow(row);
}

export function createUser(db: Database, user: User): void {
  db.prepare(
    `INSERT INTO users (
      id,
      username,
      password_hash,
      role,
      created_at,
      updated_at
    ) VALUES (
      @id,
      @username,
      @password_hash,
      @role,
      @created_at,
      @updated_at
    )`
  ).run({
    id: user.id,
    username: user.username,
    password_hash: user.passwordHash,
    role: user.role,
    created_at: user.createdAt,
    updated_at: user.updatedAt,
  });
}
