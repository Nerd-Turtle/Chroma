import type { Database } from "better-sqlite3";

export function runMigrations(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS instances (
      id TEXT PRIMARY KEY,
      friendly_name TEXT NOT NULL,
      status TEXT NOT NULL,
      bds_version TEXT NOT NULL,
      instance_path TEXT NOT NULL,
      active_world_name TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS bds_installs (
      instance_id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      version TEXT,
      download_url TEXT,
      installed_at TEXT,
      updated_at TEXT NOT NULL,
      error TEXT,
      FOREIGN KEY (instance_id) REFERENCES instances(id) ON DELETE CASCADE
    );
  `);
}
