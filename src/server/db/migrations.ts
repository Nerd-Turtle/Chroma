import type { Database } from "better-sqlite3";

export function runMigrations(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS instances (
      id TEXT PRIMARY KEY,
      friendly_name TEXT NOT NULL,
      status TEXT NOT NULL,
      bds_version TEXT NOT NULL,
      automatic_updates_enabled INTEGER NOT NULL DEFAULT 1,
      update_check_frequency TEXT NOT NULL DEFAULT 'daily',
      update_check_time TEXT NOT NULL DEFAULT '03:00',
      update_check_weekday TEXT NOT NULL DEFAULT 'sunday',
      last_auto_update_check_at TEXT,
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

    CREATE TABLE IF NOT EXISTS instance_server_settings (
      instance_id TEXT PRIMARY KEY,
      server_name TEXT NOT NULL,
      gamemode TEXT NOT NULL,
      difficulty TEXT NOT NULL,
      allow_cheats INTEGER NOT NULL,
      max_players INTEGER NOT NULL,
      online_mode INTEGER NOT NULL,
      server_port INTEGER NOT NULL,
      server_port_v6 INTEGER NOT NULL,
      view_distance INTEGER NOT NULL,
      tick_distance INTEGER NOT NULL,
      default_player_permission_level TEXT NOT NULL,
      texturepack_required INTEGER NOT NULL,
      player_idle_timeout INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (instance_id) REFERENCES instances(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  const columns = db.prepare(`PRAGMA table_info(instances)`).all() as Array<{ name: string }>;
  const columnNames = new Set(columns.map((column) => column.name));

  if (!columnNames.has("automatic_updates_enabled")) {
    db.exec(`ALTER TABLE instances ADD COLUMN automatic_updates_enabled INTEGER NOT NULL DEFAULT 1;`);
  }

  if (!columnNames.has("update_check_frequency")) {
    db.exec(`ALTER TABLE instances ADD COLUMN update_check_frequency TEXT NOT NULL DEFAULT 'daily';`);
  }

  if (!columnNames.has("update_check_time")) {
    db.exec(`ALTER TABLE instances ADD COLUMN update_check_time TEXT NOT NULL DEFAULT '03:00';`);
  }

  if (!columnNames.has("update_check_weekday")) {
    db.exec(`ALTER TABLE instances ADD COLUMN update_check_weekday TEXT NOT NULL DEFAULT 'sunday';`);
  }

  if (!columnNames.has("last_auto_update_check_at")) {
    db.exec(`ALTER TABLE instances ADD COLUMN last_auto_update_check_at TEXT;`);
  }
}
