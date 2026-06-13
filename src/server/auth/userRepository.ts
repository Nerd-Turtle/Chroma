import type { Database } from "better-sqlite3";
import type { UserRecord } from "../../shared/types/index.js";

function mapUserRow(row: any): UserRecord {
  return {
    id: row.id,
    username: row.username,
    passwordHash: row.password_hash,
    role: row.role,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getUserById(db: Database, userId: string): UserRecord | undefined {
  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
  return row ? mapUserRow(row) : undefined;
}

export function getUserByUsername(db: Database, username: string): UserRecord | undefined {
  const row = db.prepare("SELECT * FROM users WHERE username = ?").get(username);
  return row ? mapUserRow(row) : undefined;
}

export function insertUser(db: Database, user: UserRecord): void {
  db.prepare(`
    INSERT INTO users (
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
    )
  `).run({
    id: user.id,
    username: user.username,
    password_hash: user.passwordHash,
    role: user.role,
    created_at: user.createdAt,
    updated_at: user.updatedAt,
  });
}
