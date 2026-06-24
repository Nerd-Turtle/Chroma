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
      last_check_at TEXT,
      last_check_result TEXT,
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

    CREATE TABLE IF NOT EXISTS instance_runtime_events (
      id TEXT PRIMARY KEY,
      instance_id TEXT NOT NULL,
      category TEXT NOT NULL,
      action TEXT NOT NULL,
      level TEXT NOT NULL,
      message TEXT NOT NULL,
      details_json TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (instance_id) REFERENCES instances(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS addon_files (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      provider_project_id TEXT NOT NULL,
      provider_file_id TEXT NOT NULL,
      name TEXT NOT NULL,
      slug TEXT,
      summary TEXT,
      website_url TEXT,
      logo_url TEXT,
      file_name TEXT,
      file_display_name TEXT,
      file_date TEXT,
      download_count INTEGER,
      workspace_path TEXT NOT NULL,
      archive_path TEXT,
      extracted_path TEXT,
      provider_metadata_json TEXT,
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS addon_file_packs (
      id TEXT PRIMARY KEY,
      addon_file_id TEXT NOT NULL,
      pack_type TEXT NOT NULL,
      name TEXT,
      description TEXT,
      header_uuid TEXT NOT NULL,
      header_version_json TEXT NOT NULL,
      min_engine_version_json TEXT,
      source_path TEXT NOT NULL,
      manifest_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (addon_file_id) REFERENCES addon_files(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS instance_addons (
      id TEXT PRIMARY KEY,
      instance_id TEXT NOT NULL,
      addon_file_id TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      auto_update_enabled INTEGER NOT NULL DEFAULT 1,
      provider TEXT NOT NULL,
      provider_project_id TEXT NOT NULL,
      provider_file_id TEXT NOT NULL,
      name TEXT NOT NULL,
      slug TEXT,
      summary TEXT,
      website_url TEXT,
      logo_url TEXT,
      file_name TEXT,
      file_display_name TEXT,
      file_date TEXT,
      download_count INTEGER,
      status TEXT NOT NULL,
      workspace_path TEXT NOT NULL,
      archive_path TEXT,
      extracted_path TEXT,
      provider_metadata_json TEXT,
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (addon_file_id) REFERENCES addon_files(id) ON DELETE CASCADE,
      FOREIGN KEY (instance_id) REFERENCES instances(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS instance_addon_packs (
      id TEXT PRIMARY KEY,
      instance_id TEXT NOT NULL,
      addon_id TEXT NOT NULL,
      addon_file_pack_id TEXT,
      pack_type TEXT NOT NULL,
      name TEXT,
      description TEXT,
      header_uuid TEXT NOT NULL,
      header_version_json TEXT NOT NULL,
      min_engine_version_json TEXT,
      source_path TEXT NOT NULL,
      enabled_path TEXT,
      status TEXT NOT NULL,
      enabled_at TEXT,
      disabled_at TEXT,
      manifest_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (instance_id) REFERENCES instances(id) ON DELETE CASCADE,
      FOREIGN KEY (addon_id) REFERENCES instance_addons(id) ON DELETE CASCADE,
      FOREIGN KEY (addon_file_pack_id) REFERENCES addon_file_packs(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_instance_runtime_events_instance_created
      ON instance_runtime_events (instance_id, created_at DESC);

    CREATE UNIQUE INDEX IF NOT EXISTS idx_instance_addons_provider_file
      ON instance_addons (instance_id, provider, provider_project_id, provider_file_id);

    CREATE UNIQUE INDEX IF NOT EXISTS idx_addon_files_provider_file
      ON addon_files (provider, provider_project_id, provider_file_id);

    CREATE INDEX IF NOT EXISTS idx_addon_file_packs_addon_file
      ON addon_file_packs (addon_file_id);

    CREATE UNIQUE INDEX IF NOT EXISTS idx_addon_file_packs_identity
      ON addon_file_packs (addon_file_id, pack_type, header_uuid, header_version_json, source_path);

    CREATE INDEX IF NOT EXISTS idx_instance_addon_packs_pack_identity
      ON instance_addon_packs (instance_id, header_uuid, header_version_json, pack_type);

    CREATE INDEX IF NOT EXISTS idx_instance_addon_packs_addon
      ON instance_addon_packs (addon_id);
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

  if (!columnNames.has("last_check_at")) {
    db.exec(`ALTER TABLE instances ADD COLUMN last_check_at TEXT;`);
  }

  if (!columnNames.has("last_check_result")) {
    db.exec(`ALTER TABLE instances ADD COLUMN last_check_result TEXT;`);
  }

  const instanceAddonColumns = db.prepare(`PRAGMA table_info(instance_addons)`).all() as Array<{ name: string }>;
  const instanceAddonColumnNames = new Set(instanceAddonColumns.map((column) => column.name));
  if (!instanceAddonColumnNames.has("addon_file_id")) {
    db.exec(`ALTER TABLE instance_addons ADD COLUMN addon_file_id TEXT;`);
  }
  if (!instanceAddonColumnNames.has("auto_update_enabled")) {
    db.exec(`ALTER TABLE instance_addons ADD COLUMN auto_update_enabled INTEGER NOT NULL DEFAULT 1;`);
  }
  if (!instanceAddonColumnNames.has("sort_order")) {
    db.exec(`ALTER TABLE instance_addons ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;`);
  }

  const instanceAddonSortRows = db.prepare(
    `SELECT id, instance_id
      FROM instance_addons
      ORDER BY instance_id ASC, sort_order ASC, created_at ASC, id ASC`,
  ).all() as Array<{ id: string; instance_id: string }>;
  const updateInstanceAddonSortOrder = db.prepare(`UPDATE instance_addons SET sort_order = ? WHERE id = ?`);
  let currentSortInstanceId = "";
  let nextSortOrder = 1;
  for (const row of instanceAddonSortRows) {
    if (row.instance_id !== currentSortInstanceId) {
      currentSortInstanceId = row.instance_id;
      nextSortOrder = 1;
    }

    updateInstanceAddonSortOrder.run(nextSortOrder, row.id);
    nextSortOrder += 1;
  }

  const instanceAddonPackColumns = db.prepare(`PRAGMA table_info(instance_addon_packs)`).all() as Array<{ name: string }>;
  const instanceAddonPackColumnNames = new Set(instanceAddonPackColumns.map((column) => column.name));
  if (!instanceAddonPackColumnNames.has("addon_file_pack_id")) {
    db.exec(`ALTER TABLE instance_addon_packs ADD COLUMN addon_file_pack_id TEXT;`);
  }

  db.exec(`
    INSERT OR IGNORE INTO addon_files (
      id,
      provider,
      provider_project_id,
      provider_file_id,
      name,
      slug,
      summary,
      website_url,
      logo_url,
      file_name,
      file_display_name,
      file_date,
      download_count,
      workspace_path,
      archive_path,
      extracted_path,
      provider_metadata_json,
      error,
      created_at,
      updated_at
    )
    SELECT
      'afile_' || lower(hex(randomblob(8))),
      provider,
      provider_project_id,
      provider_file_id,
      name,
      slug,
      summary,
      website_url,
      logo_url,
      file_name,
      file_display_name,
      file_date,
      download_count,
      workspace_path,
      archive_path,
      extracted_path,
      provider_metadata_json,
      error,
      MIN(created_at),
      MAX(updated_at)
    FROM instance_addons
    WHERE addon_file_id IS NULL
    GROUP BY provider, provider_project_id, provider_file_id;

    UPDATE instance_addons
    SET addon_file_id = (
      SELECT addon_files.id
      FROM addon_files
      WHERE addon_files.provider = instance_addons.provider
        AND addon_files.provider_project_id = instance_addons.provider_project_id
        AND addon_files.provider_file_id = instance_addons.provider_file_id
    )
    WHERE addon_file_id IS NULL;

    INSERT OR IGNORE INTO addon_file_packs (
      id,
      addon_file_id,
      pack_type,
      name,
      description,
      header_uuid,
      header_version_json,
      min_engine_version_json,
      source_path,
      manifest_json,
      created_at,
      updated_at
    )
    SELECT
      'afpack_' || lower(hex(randomblob(8))),
      instance_addons.addon_file_id,
      instance_addon_packs.pack_type,
      instance_addon_packs.name,
      instance_addon_packs.description,
      instance_addon_packs.header_uuid,
      instance_addon_packs.header_version_json,
      instance_addon_packs.min_engine_version_json,
      instance_addon_packs.source_path,
      instance_addon_packs.manifest_json,
      MIN(instance_addon_packs.created_at),
      MAX(instance_addon_packs.updated_at)
    FROM instance_addon_packs
    JOIN instance_addons ON instance_addons.id = instance_addon_packs.addon_id
    WHERE instance_addon_packs.addon_file_pack_id IS NULL
      AND instance_addons.addon_file_id IS NOT NULL
    GROUP BY
      instance_addons.addon_file_id,
      instance_addon_packs.pack_type,
      instance_addon_packs.header_uuid,
      instance_addon_packs.header_version_json,
      instance_addon_packs.source_path;

    UPDATE instance_addon_packs
    SET addon_file_pack_id = (
      SELECT addon_file_packs.id
      FROM addon_file_packs
      JOIN instance_addons ON instance_addons.id = instance_addon_packs.addon_id
      WHERE addon_file_packs.addon_file_id = instance_addons.addon_file_id
        AND addon_file_packs.pack_type = instance_addon_packs.pack_type
        AND addon_file_packs.header_uuid = instance_addon_packs.header_uuid
        AND addon_file_packs.header_version_json = instance_addon_packs.header_version_json
        AND addon_file_packs.source_path = instance_addon_packs.source_path
      LIMIT 1
    )
    WHERE addon_file_pack_id IS NULL;
  `);
}
