import type { Database } from "better-sqlite3";

export function getAppSetting(db: Database, key: string): string | undefined {
  const row = db
    .prepare(`SELECT value FROM app_settings WHERE key = ?`)
    .get([key]) as { value: string } | undefined;

  return row?.value;
}

export function saveAppSetting(db: Database, key: string, value: string): void {
  db.prepare(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES (@key, @value, @updated_at)
     ON CONFLICT(key) DO UPDATE SET
       value = excluded.value,
       updated_at = excluded.updated_at;`
  ).run({
    key,
    value,
    updated_at: new Date().toISOString(),
  });
}
