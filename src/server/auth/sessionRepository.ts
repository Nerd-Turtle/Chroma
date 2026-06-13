import type { Database } from "better-sqlite3";
import type { SessionRecord } from "../../shared/types/index.js";

function mapSessionRow(row: any): SessionRecord {
  return {
    id: row.id,
    userId: row.user_id,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

export function insertSession(db: Database, session: SessionRecord): void {
  db.prepare(`
    INSERT INTO sessions (
      id,
      user_id,
      created_at,
      expires_at
    ) VALUES (
      @id,
      @user_id,
      @created_at,
      @expires_at
    )
  `).run({
    id: session.id,
    user_id: session.userId,
    created_at: session.createdAt,
    expires_at: session.expiresAt,
  });
}

export function getSessionById(db: Database, sessionId: string): SessionRecord | undefined {
  const row = db.prepare("SELECT * FROM sessions WHERE id = ?").get(sessionId);
  return row ? mapSessionRow(row) : undefined;
}

export function deleteSessionById(db: Database, sessionId: string): void {
  db.prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
}
