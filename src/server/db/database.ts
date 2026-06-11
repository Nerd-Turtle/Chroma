import Database from "better-sqlite3";

export function openDatabase(databasePath: string) {
  const db = new Database(databasePath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  return db;
}

export function closeDatabase(db: ReturnType<typeof openDatabase>): void {
  db.close();
}
