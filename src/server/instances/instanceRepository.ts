import type { Database } from "better-sqlite3";
import type { Instance } from "../../shared/types/index.js";

type InstanceRow = {
  id: string;
  friendly_name: string;
  status: string;
  bds_version: string;
  instance_path: string;
  active_world_name: string | null;
  created_at: string;
  updated_at: string;
};

function mapInstanceRow(row: InstanceRow): Instance {
  const instance: Instance = {
    id: row.id,
    friendlyName: row.friendly_name,
    status: row.status as Instance["status"],
    bdsVersion: row.bds_version,
    instancePath: row.instance_path,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };

  if (row.active_world_name !== null) {
    instance.activeWorldName = row.active_world_name;
  }

  return instance;
}

export function listInstances(db: Database): Instance[] {
  const rows = db
    .prepare(`SELECT * FROM instances ORDER BY created_at DESC`)
    .all([]) as InstanceRow[];
  return rows.map(mapInstanceRow);
}

export function getInstance(db: Database, instanceId: string): Instance | undefined {
  const row = db
    .prepare(`SELECT * FROM instances WHERE id = ?`)
    .get([instanceId]) as InstanceRow | undefined;

  if (!row) {
    return undefined;
  }

  return mapInstanceRow(row);
}

export function saveInstance(db: Database, instance: Instance): void {
  const statement = db.prepare(
    `INSERT INTO instances (
      id,
      friendly_name,
      status,
      bds_version,
      instance_path,
      active_world_name,
      created_at,
      updated_at
    ) VALUES (
      @id,
      @friendly_name,
      @status,
      @bds_version,
      @instance_path,
      @active_world_name,
      @created_at,
      @updated_at
    )
    ON CONFLICT(id) DO UPDATE SET
      friendly_name = excluded.friendly_name,
      status = excluded.status,
      bds_version = excluded.bds_version,
      instance_path = excluded.instance_path,
      active_world_name = excluded.active_world_name,
      updated_at = excluded.updated_at;
    `
  );

  statement.run({
    id: instance.id,
    friendly_name: instance.friendlyName,
    status: instance.status,
    bds_version: instance.bdsVersion,
    instance_path: instance.instancePath,
    active_world_name: instance.activeWorldName ?? null,
    created_at: instance.createdAt,
    updated_at: instance.updatedAt,
  });
}

export function updateInstanceStatus(db: Database, instanceId: string, status: Instance["status"]): void {
  db.prepare(
    `UPDATE instances SET status = ?, updated_at = ? WHERE id = ?`
  ).run(status, new Date().toISOString(), instanceId);
}
