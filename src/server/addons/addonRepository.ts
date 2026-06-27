import type { Database } from "better-sqlite3";
import type {
  AddonLibraryLinkedInstance,
  AddonProvider,
  AddonDownloadedFile,
  AddonDownloadedFileStatus,
  AddonLibraryItem,
  InstanceAddon,
  InstanceAddonPack,
  InstanceAddonPackCounts,
  InstanceAddonPackStatus,
  InstanceAddonPackType,
  InstanceAddonStatus,
} from "../../shared/types/index.js";

export type SaveInstanceAddonInput = Omit<InstanceAddon, "packCounts" | "downloadedFileCount" | "downloadedFileErrorCount"> & {
  providerMetadataJson?: string;
};

export type SaveInstanceAddonPackInput = Omit<InstanceAddonPack, "headerVersion" | "minEngineVersion"> & {
  headerVersionJson: string;
  minEngineVersionJson?: string;
  addonFileDownloadId?: string;
  manifestJson?: string;
};

export type SaveAddonFileInput = Omit<AddonLibraryItem, "packCounts" | "downloadedFileCount" | "downloadedFileErrorCount" | "registeredInstanceCount"> & {
  providerMetadataJson?: string;
};

export type SaveAddonFilePackInput = {
  id: string;
  addonFileId: string;
  addonFileDownloadId?: string;
  packType: InstanceAddonPackType;
  name?: string;
  description?: string;
  headerUuid: string;
  headerVersionJson: string;
  minEngineVersionJson?: string;
  sourcePath: string;
  manifestJson?: string;
  createdAt: string;
  updatedAt: string;
};

export type SaveAddonFileDownloadInput = {
  id: string;
  addonFileId: string;
  providerFileId: string;
  fileName: string;
  fileDisplayName?: string;
  fileDate?: string;
  downloadCount?: number;
  fileLength?: number;
  archivePath?: string;
  extractedPath?: string;
  status: AddonDownloadedFileStatus;
  error?: string;
  providerMetadataJson?: string;
  createdAt: string;
  updatedAt: string;
};

type InstanceAddonRow = {
  id: string;
  instance_id: string;
  addon_file_id: string;
  sort_order: number;
  auto_update_enabled: number;
  provider: string;
  provider_project_id: string;
  provider_file_id: string;
  name: string;
  slug: string | null;
  summary: string | null;
  website_url: string | null;
  logo_url: string | null;
  file_name: string | null;
  file_display_name: string | null;
  file_date: string | null;
  download_count: number | null;
  status: string;
  workspace_path: string;
  archive_path: string | null;
  extracted_path: string | null;
  error: string | null;
  behavior_count: number;
  resource_count: number;
  skin_count: number;
  unknown_count: number;
  unsupported_count: number;
  downloaded_file_count: number;
  downloaded_file_error_count: number;
  created_at: string;
  updated_at: string;
};

type AddonFileRow = {
  id: string;
  provider: string;
  provider_project_id: string;
  provider_file_id: string;
  name: string;
  slug: string | null;
  summary: string | null;
  website_url: string | null;
  logo_url: string | null;
  file_name: string | null;
  file_display_name: string | null;
  file_date: string | null;
  download_count: number | null;
  workspace_path: string;
  archive_path: string | null;
  extracted_path: string | null;
  error: string | null;
  behavior_count: number;
  resource_count: number;
  skin_count: number;
  unknown_count: number;
  unsupported_count: number;
  downloaded_file_count: number;
  downloaded_file_error_count: number;
  registered_instance_count: number;
  created_at: string;
  updated_at: string;
};

type InstanceAddonPackRow = {
  id: string;
  instance_id: string;
  addon_id: string;
  addon_file_pack_id: string;
  pack_type: string;
  name: string | null;
  description: string | null;
  header_uuid: string;
  header_version_json: string;
  min_engine_version_json: string | null;
  source_path: string;
  enabled_path: string | null;
  status: string;
  enabled_at: string | null;
  disabled_at: string | null;
  created_at: string;
  updated_at: string;
};

type AddonFilePackRow = {
  id: string;
  addon_file_id: string;
  addon_file_download_id: string | null;
  pack_type: string;
  name: string | null;
  description: string | null;
  header_uuid: string;
  header_version_json: string;
  min_engine_version_json: string | null;
  source_path: string;
  manifest_json: string | null;
  created_at: string;
  updated_at: string;
};

type AddonFileDownloadRow = {
  id: string;
  addon_file_id: string;
  provider_file_id: string;
  file_name: string;
  file_display_name: string | null;
  file_date: string | null;
  download_count: number | null;
  file_length: number | null;
  archive_path: string | null;
  extracted_path: string | null;
  status: string;
  error: string | null;
  created_at: string;
  updated_at: string;
};

type AddonLibraryLinkedInstanceRow = {
  instance_id: string;
  friendly_name: string;
  status: string;
  linked: number;
  addon_id: string | null;
  addon_status: string | null;
  auto_update_enabled: number | null;
};

function parseVersionArray(value: string): number[] {
  const parsed = JSON.parse(value) as unknown;
  return Array.isArray(parsed) && parsed.every((part) => typeof part === "number") ? parsed : [];
}

function mapPackCounts(row: {
  behavior_count: number;
  resource_count: number;
  skin_count: number;
  unknown_count: number;
  unsupported_count: number;
}): InstanceAddonPackCounts {
  return {
    behavior: row.behavior_count,
    resource: row.resource_count,
    skin: row.skin_count,
    unknown: row.unknown_count,
    unsupported: row.unsupported_count,
  };
}

function mapAddonRow(row: InstanceAddonRow): InstanceAddon {
  const addon: InstanceAddon = {
    id: row.id,
    instanceId: row.instance_id,
    addonFileId: row.addon_file_id,
    sortOrder: row.sort_order,
    autoUpdateEnabled: row.auto_update_enabled === 1,
    provider: row.provider as AddonProvider,
    providerProjectId: row.provider_project_id,
    providerFileId: row.provider_file_id,
    name: row.name,
    status: row.status as InstanceAddonStatus,
    workspacePath: row.workspace_path,
    packCounts: mapPackCounts(row),
    downloadedFileCount: row.downloaded_file_count,
    downloadedFileErrorCount: row.downloaded_file_error_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };

  if (row.slug !== null) addon.slug = row.slug;
  if (row.summary !== null) addon.summary = row.summary;
  if (row.website_url !== null) addon.websiteUrl = row.website_url;
  if (row.logo_url !== null) addon.logoUrl = row.logo_url;
  if (row.file_name !== null) addon.fileName = row.file_name;
  if (row.file_display_name !== null) addon.fileDisplayName = row.file_display_name;
  if (row.file_date !== null) addon.fileDate = row.file_date;
  if (row.download_count !== null) addon.downloadCount = row.download_count;
  if (row.archive_path !== null) addon.archivePath = row.archive_path;
  if (row.extracted_path !== null) addon.extractedPath = row.extracted_path;
  if (row.error !== null) addon.error = row.error;

  return addon;
}

function mapAddonLibraryLinkedInstanceRow(row: AddonLibraryLinkedInstanceRow): AddonLibraryLinkedInstance {
  const instance: AddonLibraryLinkedInstance = {
    instanceId: row.instance_id,
    friendlyName: row.friendly_name,
    status: row.status as AddonLibraryLinkedInstance["status"],
    linked: row.linked === 1,
    autoUpdateEnabled: row.auto_update_enabled === null ? true : row.auto_update_enabled === 1,
  };

  if (row.addon_id !== null) instance.addonId = row.addon_id;
  if (row.addon_status !== null) instance.addonStatus = row.addon_status as InstanceAddonStatus;

  return instance;
}

function mapAddonFileRow(row: AddonFileRow): AddonLibraryItem {
  const addon: AddonLibraryItem = {
    id: row.id,
    provider: row.provider as AddonProvider,
    providerProjectId: row.provider_project_id,
    providerFileId: row.provider_file_id,
    name: row.name,
    workspacePath: row.workspace_path,
    packCounts: mapPackCounts(row),
    downloadedFileCount: row.downloaded_file_count,
    downloadedFileErrorCount: row.downloaded_file_error_count,
    registeredInstanceCount: row.registered_instance_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };

  if (row.slug !== null) addon.slug = row.slug;
  if (row.summary !== null) addon.summary = row.summary;
  if (row.website_url !== null) addon.websiteUrl = row.website_url;
  if (row.logo_url !== null) addon.logoUrl = row.logo_url;
  if (row.file_name !== null) addon.fileName = row.file_name;
  if (row.file_display_name !== null) addon.fileDisplayName = row.file_display_name;
  if (row.file_date !== null) addon.fileDate = row.file_date;
  if (row.download_count !== null) addon.downloadCount = row.download_count;
  if (row.archive_path !== null) addon.archivePath = row.archive_path;
  if (row.extracted_path !== null) addon.extractedPath = row.extracted_path;
  if (row.error !== null) addon.error = row.error;

  return addon;
}

function mapPackRow(row: InstanceAddonPackRow): InstanceAddonPack {
  const pack: InstanceAddonPack = {
    id: row.id,
    instanceId: row.instance_id,
    addonId: row.addon_id,
    addonFilePackId: row.addon_file_pack_id,
    packType: row.pack_type as InstanceAddonPackType,
    headerUuid: row.header_uuid,
    headerVersion: parseVersionArray(row.header_version_json),
    sourcePath: row.source_path,
    status: row.status as InstanceAddonPackStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };

  if (row.name !== null) pack.name = row.name;
  if (row.description !== null) pack.description = row.description;
  if (row.min_engine_version_json !== null) pack.minEngineVersion = parseVersionArray(row.min_engine_version_json);
  if (row.enabled_path !== null) pack.enabledPath = row.enabled_path;
  if (row.enabled_at !== null) pack.enabledAt = row.enabled_at;
  if (row.disabled_at !== null) pack.disabledAt = row.disabled_at;

  return pack;
}

function mapAddonFileDownloadRow(row: AddonFileDownloadRow): AddonDownloadedFile {
  const file: AddonDownloadedFile = {
    id: row.id,
    addonFileId: row.addon_file_id,
    providerFileId: row.provider_file_id,
    fileName: row.file_name,
    status: row.status as AddonDownloadedFileStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };

  if (row.file_display_name !== null) file.fileDisplayName = row.file_display_name;
  if (row.file_date !== null) file.fileDate = row.file_date;
  if (row.download_count !== null) file.downloadCount = row.download_count;
  if (row.file_length !== null) file.fileLength = row.file_length;
  if (row.archive_path !== null) file.archivePath = row.archive_path;
  if (row.extracted_path !== null) file.extractedPath = row.extracted_path;
  if (row.error !== null) file.error = row.error;

  return file;
}

const addonSelectSql = `
  SELECT
    addon.id,
    addon.instance_id,
    addon.addon_file_id,
    addon.auto_update_enabled,
    file.provider,
    file.provider_project_id,
    file.provider_file_id,
    file.name,
    file.slug,
    file.summary,
    file.website_url,
    file.logo_url,
    file.file_name,
    file.file_display_name,
    file.file_date,
    file.download_count,
    addon.status,
    addon.sort_order,
    file.workspace_path,
    file.archive_path,
    file.extracted_path,
    COALESCE(addon.error, file.error) AS error,
    addon.created_at,
    addon.updated_at,
    COALESCE(SUM(CASE WHEN pack.pack_type = 'behavior' THEN 1 ELSE 0 END), 0) AS behavior_count,
    COALESCE(SUM(CASE WHEN pack.pack_type = 'resource' THEN 1 ELSE 0 END), 0) AS resource_count,
    COALESCE(SUM(CASE WHEN pack.pack_type = 'skin' THEN 1 ELSE 0 END), 0) AS skin_count,
    COALESCE(SUM(CASE WHEN pack.pack_type = 'unknown' THEN 1 ELSE 0 END), 0) AS unknown_count,
    COALESCE(SUM(CASE WHEN pack.status = 'unsupported' THEN 1 ELSE 0 END), 0) AS unsupported_count,
    (SELECT COUNT(*) FROM addon_file_downloads download WHERE download.addon_file_id = file.id) AS downloaded_file_count,
    (SELECT COUNT(*) FROM addon_file_downloads download WHERE download.addon_file_id = file.id AND download.status = 'error') AS downloaded_file_error_count
  FROM instance_addons addon
  JOIN addon_files file ON file.id = addon.addon_file_id
  LEFT JOIN instance_addon_packs pack ON pack.addon_id = addon.id
`;

export function listInstanceAddons(db: Database, instanceId: string): InstanceAddon[] {
  const rows = db.prepare(
    `${addonSelectSql}
      WHERE addon.instance_id = ?
      GROUP BY addon.id
      ORDER BY addon.sort_order ASC, addon.created_at ASC, addon.id ASC`,
  ).all(instanceId) as InstanceAddonRow[];

  return rows.map(mapAddonRow);
}

export function listAddonFiles(db: Database): AddonLibraryItem[] {
  const rows = db.prepare(
    `SELECT
        file.*,
        COALESCE(SUM(CASE WHEN pack.pack_type = 'behavior' THEN 1 ELSE 0 END), 0) AS behavior_count,
        COALESCE(SUM(CASE WHEN pack.pack_type = 'resource' THEN 1 ELSE 0 END), 0) AS resource_count,
        COALESCE(SUM(CASE WHEN pack.pack_type = 'skin' THEN 1 ELSE 0 END), 0) AS skin_count,
        COALESCE(SUM(CASE WHEN pack.pack_type = 'unknown' THEN 1 ELSE 0 END), 0) AS unknown_count,
        COALESCE(SUM(CASE WHEN pack.pack_type = 'unknown' THEN 1 ELSE 0 END), 0) AS unsupported_count,
        (SELECT COUNT(*) FROM addon_file_downloads download WHERE download.addon_file_id = file.id) AS downloaded_file_count,
        (SELECT COUNT(*) FROM addon_file_downloads download WHERE download.addon_file_id = file.id AND download.status = 'error') AS downloaded_file_error_count,
        COUNT(DISTINCT instance_addon.instance_id) AS registered_instance_count
      FROM addon_files file
      LEFT JOIN addon_file_packs pack ON pack.addon_file_id = file.id
      LEFT JOIN instance_addons instance_addon ON instance_addon.addon_file_id = file.id
      GROUP BY file.id
      ORDER BY file.created_at DESC`,
  ).all() as AddonFileRow[];

  return rows.map(mapAddonFileRow);
}

export function getAddonFile(db: Database, addonFileId: string): AddonLibraryItem | undefined {
  const row = db.prepare(
    `SELECT
        file.*,
        COALESCE(SUM(CASE WHEN pack.pack_type = 'behavior' THEN 1 ELSE 0 END), 0) AS behavior_count,
        COALESCE(SUM(CASE WHEN pack.pack_type = 'resource' THEN 1 ELSE 0 END), 0) AS resource_count,
        COALESCE(SUM(CASE WHEN pack.pack_type = 'skin' THEN 1 ELSE 0 END), 0) AS skin_count,
        COALESCE(SUM(CASE WHEN pack.pack_type = 'unknown' THEN 1 ELSE 0 END), 0) AS unknown_count,
        COALESCE(SUM(CASE WHEN pack.pack_type = 'unknown' THEN 1 ELSE 0 END), 0) AS unsupported_count,
        (SELECT COUNT(*) FROM addon_file_downloads download WHERE download.addon_file_id = file.id) AS downloaded_file_count,
        (SELECT COUNT(*) FROM addon_file_downloads download WHERE download.addon_file_id = file.id AND download.status = 'error') AS downloaded_file_error_count,
        COUNT(DISTINCT instance_addon.instance_id) AS registered_instance_count
      FROM addon_files file
      LEFT JOIN addon_file_packs pack ON pack.addon_file_id = file.id
      LEFT JOIN instance_addons instance_addon ON instance_addon.addon_file_id = file.id
      WHERE file.id = ?
      GROUP BY file.id`,
  ).get(addonFileId) as AddonFileRow | undefined;

  return row ? mapAddonFileRow(row) : undefined;
}

export function listAddonFilePacks(db: Database, addonFileId: string): SaveAddonFilePackInput[] {
  const rows = db.prepare(
    `SELECT *
      FROM addon_file_packs
      WHERE addon_file_id = ?
      ORDER BY pack_type ASC, name ASC, created_at ASC`,
  ).all(addonFileId) as AddonFilePackRow[];

  return rows.map((row) => {
    const pack: SaveAddonFilePackInput = {
      id: row.id,
      addonFileId: row.addon_file_id,
      packType: row.pack_type as InstanceAddonPackType,
      headerUuid: row.header_uuid,
      headerVersionJson: row.header_version_json,
      sourcePath: row.source_path,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };

    if (row.addon_file_download_id !== null) pack.addonFileDownloadId = row.addon_file_download_id;
    if (row.name !== null) pack.name = row.name;
    if (row.description !== null) pack.description = row.description;
    if (row.min_engine_version_json !== null) pack.minEngineVersionJson = row.min_engine_version_json;
    if (row.manifest_json !== null) pack.manifestJson = row.manifest_json;

    return pack;
  });
}

export function listAddonFileDownloads(db: Database, addonFileId: string): AddonDownloadedFile[] {
  const rows = db.prepare(
    `SELECT id,
        addon_file_id,
        provider_file_id,
        file_name,
        file_display_name,
        file_date,
        download_count,
        file_length,
        archive_path,
        extracted_path,
        status,
        error,
        created_at,
        updated_at
      FROM addon_file_downloads
      WHERE addon_file_id = ?
      ORDER BY file_date DESC, provider_file_id ASC`,
  ).all(addonFileId) as AddonFileDownloadRow[];

  return rows.map(mapAddonFileDownloadRow);
}

export function saveAddonFilePacks(db: Database, addonFileId: string, packs: SaveAddonFilePackInput[]): void {
  const save = db.transaction(() => {
    const findExistingPackByExactType = db.prepare(
      `SELECT id
      FROM addon_file_packs
      WHERE addon_file_id = ?
        AND pack_type = ?
        AND header_uuid = ?
        AND header_version_json = ?
        AND source_path = ?`,
    );
    const findExistingPackByIdentity = db.prepare(
      `SELECT id
      FROM addon_file_packs
      WHERE addon_file_id = ?
        AND header_uuid = ?
        AND header_version_json = ?
        AND source_path = ?`,
    );
    const updatePack = db.prepare(
      `UPDATE addon_file_packs
      SET pack_type = @pack_type,
        addon_file_download_id = @addon_file_download_id,
        name = @name,
        description = @description,
        min_engine_version_json = @min_engine_version_json,
        manifest_json = @manifest_json,
        updated_at = @updated_at
      WHERE id = @id`,
    );
    const insertPack = db.prepare(
      `INSERT INTO addon_file_packs (
        id,
        addon_file_id,
        addon_file_download_id,
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
      ) VALUES (
        @id,
        @addon_file_id,
        @addon_file_download_id,
        @pack_type,
        @name,
        @description,
        @header_uuid,
        @header_version_json,
        @min_engine_version_json,
        @source_path,
        @manifest_json,
        @created_at,
        @updated_at
      )`,
    );

    for (const pack of packs) {
      const existingPack =
        (findExistingPackByExactType.get(
          addonFileId,
          pack.packType,
          pack.headerUuid,
          pack.headerVersionJson,
          pack.sourcePath,
        ) as { id: string } | undefined) ??
        (findExistingPackByIdentity.get(
          addonFileId,
          pack.headerUuid,
          pack.headerVersionJson,
          pack.sourcePath,
        ) as { id: string } | undefined);
      const persistedPackId = existingPack?.id ?? pack.id;
      const persistedPack = {
        id: persistedPackId,
        addon_file_id: addonFileId,
        addon_file_download_id: pack.addonFileDownloadId ?? null,
        pack_type: pack.packType,
        name: pack.name ?? null,
        description: pack.description ?? null,
        header_uuid: pack.headerUuid,
        header_version_json: pack.headerVersionJson,
        min_engine_version_json: pack.minEngineVersionJson ?? null,
        source_path: pack.sourcePath,
        manifest_json: pack.manifestJson ?? null,
        created_at: pack.createdAt,
        updated_at: pack.updatedAt,
      };

      if (existingPack) {
        updatePack.run(persistedPack);
      } else {
        insertPack.run(persistedPack);
      }
    }
  });

  save();
}

export function markAddonFileRecovered(db: Database, addonFileId: string, updatedAt: string): void {
  const update = db.transaction(() => {
    db.prepare(
      `UPDATE addon_files
        SET error = NULL,
            updated_at = ?
        WHERE id = ?`,
    ).run(updatedAt, addonFileId);

    db.prepare(
      `UPDATE instance_addons
        SET status = CASE WHEN status = 'error' THEN 'downloaded' ELSE status END,
            error = NULL,
            updated_at = ?
        WHERE addon_file_id = ?`,
    ).run(updatedAt, addonFileId);
  });

  update();
}

export function listAddonLibraryLinkedInstances(db: Database, addonFileId: string): AddonLibraryLinkedInstance[] {
  const rows = db.prepare(
    `SELECT
        inst.id AS instance_id,
        inst.friendly_name,
        inst.status,
        CASE WHEN addon.id IS NULL THEN 0 ELSE 1 END AS linked,
        addon.id AS addon_id,
        addon.status AS addon_status,
        addon.auto_update_enabled
      FROM instances inst
      LEFT JOIN instance_addons addon
        ON addon.instance_id = inst.id
        AND addon.addon_file_id = ?
      ORDER BY inst.created_at DESC`,
  ).all(addonFileId) as AddonLibraryLinkedInstanceRow[];

  return rows.map(mapAddonLibraryLinkedInstanceRow);
}

export function deleteAddonFileById(db: Database, addonFileId: string): void {
  db.prepare(`DELETE FROM addon_files WHERE id = ?`).run(addonFileId);
}

export function deleteInstanceAddonById(db: Database, instanceId: string, addonId: string): void {
  db.prepare(`DELETE FROM instance_addons WHERE instance_id = ? AND id = ?`).run(instanceId, addonId);
}

export function getInstanceAddonByProviderProject(
  db: Database,
  instanceId: string,
  provider: AddonProvider,
  providerProjectId: string,
): InstanceAddon | undefined {
  const row = db.prepare(
    `${addonSelectSql}
      WHERE addon.instance_id = ?
        AND file.provider = ?
        AND file.provider_project_id = ?
      GROUP BY addon.id
      ORDER BY addon.created_at DESC
      LIMIT 1`,
  ).get(instanceId, provider, providerProjectId) as InstanceAddonRow | undefined;

  return row ? mapAddonRow(row) : undefined;
}

export function updateInstanceAddonAutoUpdate(db: Database, addonId: string, autoUpdateEnabled: boolean): void {
  db.prepare(
    `UPDATE instance_addons
      SET auto_update_enabled = ?, updated_at = ?
      WHERE id = ?`,
  ).run(autoUpdateEnabled ? 1 : 0, new Date().toISOString(), addonId);
}

export function getAddonFileByProviderFile(
  db: Database,
  provider: AddonProvider,
  providerProjectId: string,
  providerFileId: string,
): AddonLibraryItem | undefined {
  const row = db.prepare(
    `SELECT
        file.*,
        COALESCE(SUM(CASE WHEN pack.pack_type = 'behavior' THEN 1 ELSE 0 END), 0) AS behavior_count,
        COALESCE(SUM(CASE WHEN pack.pack_type = 'resource' THEN 1 ELSE 0 END), 0) AS resource_count,
        COALESCE(SUM(CASE WHEN pack.pack_type = 'skin' THEN 1 ELSE 0 END), 0) AS skin_count,
        COALESCE(SUM(CASE WHEN pack.pack_type = 'unknown' THEN 1 ELSE 0 END), 0) AS unknown_count,
        COALESCE(SUM(CASE WHEN pack.pack_type = 'unknown' THEN 1 ELSE 0 END), 0) AS unsupported_count,
        (SELECT COUNT(*) FROM addon_file_downloads download WHERE download.addon_file_id = file.id) AS downloaded_file_count,
        (SELECT COUNT(*) FROM addon_file_downloads download WHERE download.addon_file_id = file.id AND download.status = 'error') AS downloaded_file_error_count,
        COUNT(DISTINCT instance_addon.instance_id) AS registered_instance_count
      FROM addon_files file
      LEFT JOIN addon_file_packs pack ON pack.addon_file_id = file.id
      LEFT JOIN instance_addons instance_addon ON instance_addon.addon_file_id = file.id
      WHERE file.provider = ? AND file.provider_project_id = ? AND file.provider_file_id = ?
      GROUP BY file.id`,
  ).get(provider, providerProjectId, providerFileId) as AddonFileRow | undefined;

  return row ? mapAddonFileRow(row) : undefined;
}

export function saveAddonFileWithPacks(
  db: Database,
  addon: SaveAddonFileInput,
  packs: SaveAddonFilePackInput[],
  downloads: SaveAddonFileDownloadInput[] = [],
): void {
  const save = db.transaction(() => {
    db.prepare(
      `INSERT INTO addon_files (
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
      ) VALUES (
        @id,
        @provider,
        @provider_project_id,
        @provider_file_id,
        @name,
        @slug,
        @summary,
        @website_url,
        @logo_url,
        @file_name,
        @file_display_name,
        @file_date,
        @download_count,
        @workspace_path,
        @archive_path,
        @extracted_path,
        @provider_metadata_json,
        @error,
        @created_at,
        @updated_at
      )
      ON CONFLICT(provider, provider_project_id, provider_file_id) DO UPDATE SET
        name = excluded.name,
        slug = excluded.slug,
        summary = excluded.summary,
        website_url = excluded.website_url,
        logo_url = excluded.logo_url,
        file_name = excluded.file_name,
        file_display_name = excluded.file_display_name,
        file_date = excluded.file_date,
        download_count = excluded.download_count,
        workspace_path = excluded.workspace_path,
        archive_path = excluded.archive_path,
        extracted_path = excluded.extracted_path,
        provider_metadata_json = excluded.provider_metadata_json,
        error = excluded.error,
        updated_at = excluded.updated_at`,
    ).run({
      id: addon.id,
      provider: addon.provider,
      provider_project_id: addon.providerProjectId,
      provider_file_id: addon.providerFileId,
      name: addon.name,
      slug: addon.slug ?? null,
      summary: addon.summary ?? null,
      website_url: addon.websiteUrl ?? null,
      logo_url: addon.logoUrl ?? null,
      file_name: addon.fileName ?? null,
      file_display_name: addon.fileDisplayName ?? null,
      file_date: addon.fileDate ?? null,
      download_count: addon.downloadCount ?? null,
      workspace_path: addon.workspacePath,
      archive_path: addon.archivePath ?? null,
      extracted_path: addon.extractedPath ?? null,
      provider_metadata_json: addon.providerMetadataJson ?? null,
      error: addon.error ?? null,
      created_at: addon.createdAt,
      updated_at: addon.updatedAt,
    });

    const addonFile = db.prepare(
      `SELECT id FROM addon_files WHERE provider = ? AND provider_project_id = ? AND provider_file_id = ?`,
    ).get(addon.provider, addon.providerProjectId, addon.providerFileId) as { id: string } | undefined;

    if (!addonFile) {
      throw new Error("Failed to save addon file record.");
    }

    const upsertDownload = db.prepare(
      `INSERT INTO addon_file_downloads (
        id,
        addon_file_id,
        provider_file_id,
        file_name,
        file_display_name,
        file_date,
        download_count,
        file_length,
        archive_path,
        extracted_path,
        status,
        error,
        provider_metadata_json,
        created_at,
        updated_at
      ) VALUES (
        @id,
        @addon_file_id,
        @provider_file_id,
        @file_name,
        @file_display_name,
        @file_date,
        @download_count,
        @file_length,
        @archive_path,
        @extracted_path,
        @status,
        @error,
        @provider_metadata_json,
        @created_at,
        @updated_at
      )
      ON CONFLICT(addon_file_id, provider_file_id) DO UPDATE SET
        id = excluded.id,
        file_name = excluded.file_name,
        file_display_name = excluded.file_display_name,
        file_date = excluded.file_date,
        download_count = excluded.download_count,
        file_length = excluded.file_length,
        archive_path = excluded.archive_path,
        extracted_path = excluded.extracted_path,
        status = excluded.status,
        error = excluded.error,
        provider_metadata_json = excluded.provider_metadata_json,
        updated_at = excluded.updated_at`,
    );

    for (const download of downloads) {
      upsertDownload.run({
        id: download.id,
        addon_file_id: addonFile.id,
        provider_file_id: download.providerFileId,
        file_name: download.fileName,
        file_display_name: download.fileDisplayName ?? null,
        file_date: download.fileDate ?? null,
        download_count: download.downloadCount ?? null,
        file_length: download.fileLength ?? null,
        archive_path: download.archivePath ?? null,
        extracted_path: download.extractedPath ?? null,
        status: download.status,
        error: download.error ?? null,
        provider_metadata_json: download.providerMetadataJson ?? null,
        created_at: download.createdAt,
        updated_at: download.updatedAt,
      });
    }

    const findExistingPackByExactType = db.prepare(
      `SELECT id
      FROM addon_file_packs
      WHERE addon_file_id = ?
        AND pack_type = ?
        AND header_uuid = ?
        AND header_version_json = ?
        AND source_path = ?`,
    );
    const findExistingPackByIdentity = db.prepare(
      `SELECT id
      FROM addon_file_packs
      WHERE addon_file_id = ?
        AND header_uuid = ?
        AND header_version_json = ?
        AND source_path = ?`,
    );
    const updatePack = db.prepare(
      `UPDATE addon_file_packs
      SET pack_type = @pack_type,
        addon_file_download_id = @addon_file_download_id,
        name = @name,
        description = @description,
        min_engine_version_json = @min_engine_version_json,
        manifest_json = @manifest_json,
        updated_at = @updated_at
      WHERE id = @id`,
    );
    const insertPack = db.prepare(
      `INSERT INTO addon_file_packs (
        id,
        addon_file_id,
        addon_file_download_id,
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
      ) VALUES (
        @id,
        @addon_file_id,
        @addon_file_download_id,
        @pack_type,
        @name,
        @description,
        @header_uuid,
        @header_version_json,
        @min_engine_version_json,
        @source_path,
        @manifest_json,
        @created_at,
        @updated_at
      )`,
    );

    for (const pack of packs) {
      const existingPack =
        (findExistingPackByExactType.get(
          addonFile.id,
          pack.packType,
          pack.headerUuid,
          pack.headerVersionJson,
          pack.sourcePath,
        ) as { id: string } | undefined) ??
        (findExistingPackByIdentity.get(
          addonFile.id,
          pack.headerUuid,
          pack.headerVersionJson,
          pack.sourcePath,
        ) as { id: string } | undefined);
      const persistedPackId = existingPack?.id ?? pack.id;
      const persistedPack = {
        id: persistedPackId,
        addon_file_id: addonFile.id,
        addon_file_download_id: pack.addonFileDownloadId ?? null,
        pack_type: pack.packType,
        name: pack.name ?? null,
        description: pack.description ?? null,
        header_uuid: pack.headerUuid,
        header_version_json: pack.headerVersionJson,
        min_engine_version_json: pack.minEngineVersionJson ?? null,
        source_path: pack.sourcePath,
        manifest_json: pack.manifestJson ?? null,
        created_at: pack.createdAt,
        updated_at: pack.updatedAt,
      };

      if (existingPack) {
        updatePack.run(persistedPack);
      } else {
        insertPack.run(persistedPack);
      }
    }
  });

  save();
}

export function getInstanceAddon(db: Database, instanceId: string, addonId: string): InstanceAddon | undefined {
  const row = db.prepare(
    `${addonSelectSql}
      WHERE addon.instance_id = ? AND addon.id = ?
      GROUP BY addon.id`,
  ).get(instanceId, addonId) as InstanceAddonRow | undefined;

  return row ? mapAddonRow(row) : undefined;
}

export function getInstanceAddonByProviderFile(
  db: Database,
  instanceId: string,
  provider: AddonProvider,
  providerProjectId: string,
  providerFileId: string,
): InstanceAddon | undefined {
  const row = db.prepare(
    `${addonSelectSql}
      WHERE addon.instance_id = ?
        AND file.provider = ?
        AND file.provider_project_id = ?
        AND file.provider_file_id = ?
      GROUP BY addon.id`,
  ).get(instanceId, provider, providerProjectId, providerFileId) as InstanceAddonRow | undefined;

  return row ? mapAddonRow(row) : undefined;
}

export function listInstanceAddonPacks(db: Database, instanceId: string, addonId: string): InstanceAddonPack[] {
  const rows = db.prepare(
    `SELECT
        pack.id,
        pack.instance_id,
        pack.addon_id,
        pack.addon_file_pack_id,
        file_pack.pack_type,
        file_pack.name,
        file_pack.description,
        file_pack.header_uuid,
        file_pack.header_version_json,
        file_pack.min_engine_version_json,
        file_pack.source_path,
        pack.enabled_path,
        pack.status,
        pack.enabled_at,
        pack.disabled_at,
        pack.created_at,
        pack.updated_at
      FROM instance_addon_packs pack
      JOIN addon_file_packs file_pack ON file_pack.id = pack.addon_file_pack_id
      WHERE pack.instance_id = ? AND pack.addon_id = ?
      ORDER BY file_pack.pack_type ASC, file_pack.name ASC, pack.created_at ASC`,
  ).all(instanceId, addonId) as InstanceAddonPackRow[];

  return rows.map(mapPackRow);
}

export function getNextInstanceAddonSortOrder(db: Database, instanceId: string): number {
  const row = db.prepare(
    `SELECT COALESCE(MAX(sort_order), 0) AS max_sort_order
      FROM instance_addons
      WHERE instance_id = ?`,
  ).get(instanceId) as { max_sort_order: number };

  return row.max_sort_order + 1;
}

export function saveInstanceAddonWithPacks(
  db: Database,
  addon: SaveInstanceAddonInput,
  packs: SaveInstanceAddonPackInput[],
  downloads: SaveAddonFileDownloadInput[] = [],
): void {
  const save = db.transaction(() => {
    db.prepare(
      `INSERT INTO addon_files (
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
      ) VALUES (
        @id,
        @provider,
        @provider_project_id,
        @provider_file_id,
        @name,
        @slug,
        @summary,
        @website_url,
        @logo_url,
        @file_name,
        @file_display_name,
        @file_date,
        @download_count,
        @workspace_path,
        @archive_path,
        @extracted_path,
        @provider_metadata_json,
        @error,
        @created_at,
        @updated_at
      )
      ON CONFLICT(provider, provider_project_id, provider_file_id) DO UPDATE SET
        name = excluded.name,
        slug = excluded.slug,
        summary = excluded.summary,
        website_url = excluded.website_url,
        logo_url = excluded.logo_url,
        file_name = excluded.file_name,
        file_display_name = excluded.file_display_name,
        file_date = excluded.file_date,
        download_count = excluded.download_count,
        workspace_path = excluded.workspace_path,
        archive_path = excluded.archive_path,
        extracted_path = excluded.extracted_path,
        provider_metadata_json = excluded.provider_metadata_json,
        error = excluded.error,
        updated_at = excluded.updated_at`,
    ).run({
      id: addon.addonFileId,
      provider: addon.provider,
      provider_project_id: addon.providerProjectId,
      provider_file_id: addon.providerFileId,
      name: addon.name,
      slug: addon.slug ?? null,
      summary: addon.summary ?? null,
      website_url: addon.websiteUrl ?? null,
      logo_url: addon.logoUrl ?? null,
      file_name: addon.fileName ?? null,
      file_display_name: addon.fileDisplayName ?? null,
      file_date: addon.fileDate ?? null,
      download_count: addon.downloadCount ?? null,
      workspace_path: addon.workspacePath,
      archive_path: addon.archivePath ?? null,
      extracted_path: addon.extractedPath ?? null,
      provider_metadata_json: addon.providerMetadataJson ?? null,
      error: addon.error ?? null,
      created_at: addon.createdAt,
      updated_at: addon.updatedAt,
    });

    const addonFile = db.prepare(
      `SELECT id FROM addon_files WHERE provider = ? AND provider_project_id = ? AND provider_file_id = ?`,
    ).get(addon.provider, addon.providerProjectId, addon.providerFileId) as { id: string } | undefined;

    if (!addonFile) {
      throw new Error("Failed to save addon file record.");
    }

    const upsertDownload = db.prepare(
      `INSERT INTO addon_file_downloads (
        id,
        addon_file_id,
        provider_file_id,
        file_name,
        file_display_name,
        file_date,
        download_count,
        file_length,
        archive_path,
        extracted_path,
        status,
        error,
        provider_metadata_json,
        created_at,
        updated_at
      ) VALUES (
        @id,
        @addon_file_id,
        @provider_file_id,
        @file_name,
        @file_display_name,
        @file_date,
        @download_count,
        @file_length,
        @archive_path,
        @extracted_path,
        @status,
        @error,
        @provider_metadata_json,
        @created_at,
        @updated_at
      )
      ON CONFLICT(addon_file_id, provider_file_id) DO UPDATE SET
        id = excluded.id,
        file_name = excluded.file_name,
        file_display_name = excluded.file_display_name,
        file_date = excluded.file_date,
        download_count = excluded.download_count,
        file_length = excluded.file_length,
        archive_path = excluded.archive_path,
        extracted_path = excluded.extracted_path,
        status = excluded.status,
        error = excluded.error,
        provider_metadata_json = excluded.provider_metadata_json,
        updated_at = excluded.updated_at`,
    );

    for (const download of downloads) {
      upsertDownload.run({
        id: download.id,
        addon_file_id: addonFile.id,
        provider_file_id: download.providerFileId,
        file_name: download.fileName,
        file_display_name: download.fileDisplayName ?? null,
        file_date: download.fileDate ?? null,
        download_count: download.downloadCount ?? null,
        file_length: download.fileLength ?? null,
        archive_path: download.archivePath ?? null,
        extracted_path: download.extractedPath ?? null,
        status: download.status,
        error: download.error ?? null,
        provider_metadata_json: download.providerMetadataJson ?? null,
        created_at: download.createdAt,
        updated_at: download.updatedAt,
      });
    }

    db.prepare(
      `INSERT INTO instance_addons (
        id,
        instance_id,
        addon_file_id,
        sort_order,
        auto_update_enabled,
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
        status,
        workspace_path,
        archive_path,
        extracted_path,
        provider_metadata_json,
        error,
        created_at,
        updated_at
      ) VALUES (
        @id,
        @instance_id,
        @addon_file_id,
        @sort_order,
        @auto_update_enabled,
        @provider,
        @provider_project_id,
        @provider_file_id,
        @name,
        @slug,
        @summary,
        @website_url,
        @logo_url,
        @file_name,
        @file_display_name,
        @file_date,
        @download_count,
        @status,
        @workspace_path,
        @archive_path,
        @extracted_path,
        @provider_metadata_json,
        @error,
        @created_at,
        @updated_at
      )
      ON CONFLICT(instance_id, provider, provider_project_id, provider_file_id) DO UPDATE SET
        addon_file_id = excluded.addon_file_id,
        sort_order = excluded.sort_order,
        auto_update_enabled = excluded.auto_update_enabled,
        name = excluded.name,
        slug = excluded.slug,
        summary = excluded.summary,
        website_url = excluded.website_url,
        logo_url = excluded.logo_url,
        file_name = excluded.file_name,
        file_display_name = excluded.file_display_name,
        file_date = excluded.file_date,
        download_count = excluded.download_count,
        status = excluded.status,
        workspace_path = excluded.workspace_path,
        archive_path = excluded.archive_path,
        extracted_path = excluded.extracted_path,
        provider_metadata_json = excluded.provider_metadata_json,
        error = excluded.error,
        updated_at = excluded.updated_at`,
    ).run({
      id: addon.id,
      instance_id: addon.instanceId,
      addon_file_id: addonFile.id,
      sort_order: addon.sortOrder,
      auto_update_enabled: addon.autoUpdateEnabled ? 1 : 0,
      provider: addon.provider,
      provider_project_id: addon.providerProjectId,
      provider_file_id: addon.providerFileId,
      name: addon.name,
      slug: addon.slug ?? null,
      summary: addon.summary ?? null,
      website_url: addon.websiteUrl ?? null,
      logo_url: addon.logoUrl ?? null,
      file_name: addon.fileName ?? null,
      file_display_name: addon.fileDisplayName ?? null,
      file_date: addon.fileDate ?? null,
      download_count: addon.downloadCount ?? null,
      status: addon.status,
      workspace_path: addon.workspacePath,
      archive_path: addon.archivePath ?? null,
      extracted_path: addon.extractedPath ?? null,
      provider_metadata_json: addon.providerMetadataJson ?? null,
      error: addon.error ?? null,
      created_at: addon.createdAt,
      updated_at: addon.updatedAt,
    });

    db.prepare(`DELETE FROM instance_addon_packs WHERE addon_id = ?`).run(addon.id);

    const insertPack = db.prepare(
      `INSERT INTO instance_addon_packs (
        id,
        instance_id,
        addon_id,
        addon_file_pack_id,
        pack_type,
        name,
        description,
        header_uuid,
        header_version_json,
        min_engine_version_json,
        source_path,
        enabled_path,
        status,
        enabled_at,
        disabled_at,
        manifest_json,
        created_at,
        updated_at
      ) VALUES (
        @id,
        @instance_id,
        @addon_id,
        @addon_file_pack_id,
        @pack_type,
        @name,
        @description,
        @header_uuid,
        @header_version_json,
        @min_engine_version_json,
        @source_path,
        @enabled_path,
        @status,
        @enabled_at,
        @disabled_at,
        @manifest_json,
        @created_at,
        @updated_at
      )`,
    );

    for (const pack of packs) {
      db.prepare(
        `INSERT INTO addon_file_packs (
        id,
        addon_file_id,
        addon_file_download_id,
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
        ) VALUES (
        @id,
        @addon_file_id,
        @addon_file_download_id,
        @pack_type,
          @name,
          @description,
          @header_uuid,
          @header_version_json,
          @min_engine_version_json,
          @source_path,
          @manifest_json,
          @created_at,
          @updated_at
        )
        ON CONFLICT(addon_file_id, pack_type, header_uuid, header_version_json, source_path) DO UPDATE SET
          addon_file_download_id = excluded.addon_file_download_id,
          name = excluded.name,
          description = excluded.description,
          min_engine_version_json = excluded.min_engine_version_json,
          manifest_json = excluded.manifest_json,
          updated_at = excluded.updated_at`,
      ).run({
        id: pack.addonFilePackId,
        addon_file_id: addonFile.id,
        addon_file_download_id: pack.addonFileDownloadId ?? null,
        pack_type: pack.packType,
        name: pack.name ?? null,
        description: pack.description ?? null,
        header_uuid: pack.headerUuid,
        header_version_json: pack.headerVersionJson,
        min_engine_version_json: pack.minEngineVersionJson ?? null,
        source_path: pack.sourcePath,
        manifest_json: pack.manifestJson ?? null,
        created_at: pack.createdAt,
        updated_at: pack.updatedAt,
      });

      const addonFilePack = db.prepare(
        `SELECT id
          FROM addon_file_packs
          WHERE addon_file_id = ?
            AND pack_type = ?
            AND header_uuid = ?
            AND header_version_json = ?
            AND source_path = ?`,
      ).get(addonFile.id, pack.packType, pack.headerUuid, pack.headerVersionJson, pack.sourcePath) as { id: string } | undefined;

      if (!addonFilePack) {
        throw new Error("Failed to save addon file pack record.");
      }

      insertPack.run({
        id: pack.id,
        instance_id: pack.instanceId,
        addon_id: pack.addonId,
        addon_file_pack_id: addonFilePack.id,
        pack_type: pack.packType,
        name: pack.name ?? null,
        description: pack.description ?? null,
        header_uuid: pack.headerUuid,
        header_version_json: pack.headerVersionJson,
        min_engine_version_json: pack.minEngineVersionJson ?? null,
        source_path: pack.sourcePath,
        enabled_path: pack.enabledPath ?? null,
        status: pack.status,
        enabled_at: pack.enabledAt ?? null,
        disabled_at: pack.disabledAt ?? null,
        manifest_json: pack.manifestJson ?? null,
        created_at: pack.createdAt,
        updated_at: pack.updatedAt,
      });
    }
  });

  save();
}

export function updateInstanceAddonEnablement(
  db: Database,
  addonId: string,
  addonStatus: InstanceAddonStatus,
  packs: Array<{
    packId: string;
    status: InstanceAddonPackStatus;
    enabledPath?: string;
    enabledAt?: string;
    disabledAt?: string;
  }>,
  updatedAt: string,
): void {
  const update = db.transaction(() => {
    db.prepare(`UPDATE instance_addons SET status = ?, updated_at = ? WHERE id = ?`).run(addonStatus, updatedAt, addonId);

    const updatePack = db.prepare(
      `UPDATE instance_addon_packs
        SET status = ?,
            enabled_path = ?,
            enabled_at = ?,
            disabled_at = ?,
            updated_at = ?
        WHERE id = ?`,
    );

    for (const pack of packs) {
      updatePack.run(
        pack.status,
        pack.enabledPath ?? null,
        pack.enabledAt ?? null,
        pack.disabledAt ?? null,
        updatedAt,
        pack.packId,
      );
    }
  });

  update();
}

export function updateInstanceAddonSortOrders(
  db: Database,
  instanceId: string,
  addonIdsInOrder: string[],
  updatedAt: string,
): void {
  const update = db.transaction(() => {
    const statement = db.prepare(
      `UPDATE instance_addons
        SET sort_order = ?,
            updated_at = ?
        WHERE instance_id = ?
          AND id = ?`,
    );

    addonIdsInOrder.forEach((addonId, index) => {
      statement.run(index + 1, updatedAt, instanceId, addonId);
    });
  });

  update();
}
