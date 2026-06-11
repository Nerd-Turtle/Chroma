import type { Database } from "better-sqlite3";
import type { BdsInstall } from "../../shared/types/bds.js";

type BdsInstallRow = {
  instance_id: string;
  status: string;
  version: string | null;
  download_url: string | null;
  installed_at: string | null;
  updated_at: string;
  error: string | null;
};

function mapBdsInstallRow(row: BdsInstallRow): BdsInstall {
  const install: BdsInstall = {
    instanceId: row.instance_id,
    status: row.status as BdsInstall["status"],
    updatedAt: row.updated_at,
  };

  if (row.version !== null) {
    install.version = row.version;
  }

  if (row.download_url !== null) {
    install.downloadUrl = row.download_url;
  }

  if (row.installed_at !== null) {
    install.installedAt = row.installed_at;
  }

  if (row.error !== null) {
    install.error = row.error;
  }

  return install;
}

export function getBdsInstall(db: Database, instanceId: string): BdsInstall | undefined {
  const row = db
    .prepare(`SELECT * FROM bds_installs WHERE instance_id = ?`)
    .get([instanceId]) as BdsInstallRow | undefined;

  if (!row) {
    return undefined;
  }

  return mapBdsInstallRow(row);
}

export function saveBdsInstall(db: Database, install: BdsInstall): void {
  const statement = db.prepare(
    `INSERT INTO bds_installs (
      instance_id,
      status,
      version,
      download_url,
      installed_at,
      updated_at,
      error
    ) VALUES (
      @instance_id,
      @status,
      @version,
      @download_url,
      @installed_at,
      @updated_at,
      @error
    )
    ON CONFLICT(instance_id) DO UPDATE SET
      status = excluded.status,
      version = excluded.version,
      download_url = excluded.download_url,
      installed_at = excluded.installed_at,
      updated_at = excluded.updated_at,
      error = excluded.error;
    `,
  );

  statement.run({
    instance_id: install.instanceId,
    status: install.status,
    version: install.version ?? null,
    download_url: install.downloadUrl ?? null,
    installed_at: install.installedAt ?? null,
    updated_at: install.updatedAt,
    error: install.error ?? null,
  });
}
