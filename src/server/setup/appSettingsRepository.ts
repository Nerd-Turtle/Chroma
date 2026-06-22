import type { Database } from "better-sqlite3";

type AppSettingRow = {
  key: string;
  value: string;
};

export function getAppSetting(db: Database, key: string): string | undefined {
  const row = db.prepare("SELECT key, value FROM app_settings WHERE key = ?").get(key) as AppSettingRow | undefined;
  return row?.value;
}

export function upsertAppSetting(db: Database, key: string, value: string, updatedAt: string): void {
  db.prepare(`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES (@key, @value, @updated_at)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = excluded.updated_at
  `).run({
    key,
    value,
    updated_at: updatedAt,
  });
}

export function deleteAppSetting(db: Database, key: string): void {
  db.prepare("DELETE FROM app_settings WHERE key = ?").run(key);
}
