import type { Database } from "better-sqlite3";
import type { Instance } from "../../shared/types/index.js";

type InstanceRow = {
  id: string;
  friendly_name: string;
  status: string;
  bds_version: string;
  automatic_updates_enabled: number;
  update_check_frequency: string;
  update_check_time: string;
  update_check_weekday: string;
  last_auto_update_check_at: string | null;
  last_check_at: string | null;
  last_check_result: string | null;
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
    automaticUpdatesEnabled: row.automatic_updates_enabled === 1,
    updateCheckFrequency: row.update_check_frequency as Instance["updateCheckFrequency"],
    updateCheckTime: row.update_check_time,
    updateCheckWeekday: row.update_check_weekday as Instance["updateCheckWeekday"],
    instancePath: row.instance_path,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };

  if (row.last_auto_update_check_at !== null) {
    instance.lastAutoUpdateCheckAt = row.last_auto_update_check_at;
  }

  if (row.last_check_at !== null) {
    instance.lastCheckAt = row.last_check_at;
  }

  if (row.last_check_result !== null) {
    instance.lastCheckResult = row.last_check_result;
  }

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
      automatic_updates_enabled,
      update_check_frequency,
      update_check_time,
      update_check_weekday,
      last_auto_update_check_at,
      last_check_at,
      last_check_result,
      instance_path,
      active_world_name,
      created_at,
      updated_at
    ) VALUES (
      @id,
      @friendly_name,
      @status,
      @bds_version,
      @automatic_updates_enabled,
      @update_check_frequency,
      @update_check_time,
      @update_check_weekday,
      @last_auto_update_check_at,
      @last_check_at,
      @last_check_result,
      @instance_path,
      @active_world_name,
      @created_at,
      @updated_at
    )
    ON CONFLICT(id) DO UPDATE SET
      friendly_name = excluded.friendly_name,
      status = excluded.status,
      bds_version = excluded.bds_version,
      automatic_updates_enabled = excluded.automatic_updates_enabled,
      update_check_frequency = excluded.update_check_frequency,
      update_check_time = excluded.update_check_time,
      update_check_weekday = excluded.update_check_weekday,
      last_auto_update_check_at = excluded.last_auto_update_check_at,
      last_check_at = excluded.last_check_at,
      last_check_result = excluded.last_check_result,
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
    automatic_updates_enabled: instance.automaticUpdatesEnabled ? 1 : 0,
    update_check_frequency: instance.updateCheckFrequency,
    update_check_time: instance.updateCheckTime,
    update_check_weekday: instance.updateCheckWeekday,
    last_auto_update_check_at: instance.lastAutoUpdateCheckAt ?? null,
    last_check_at: instance.lastCheckAt ?? null,
    last_check_result: instance.lastCheckResult ?? null,
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

export function updateInstanceAutoUpdateCheckAt(db: Database, instanceId: string, checkedAt: string): void {
  db.prepare(
    `UPDATE instances SET last_auto_update_check_at = ?, updated_at = ? WHERE id = ?`
  ).run(checkedAt, new Date().toISOString(), instanceId);
}

export function updateInstanceLastCheck(
  db: Database,
  instanceId: string,
  checkedAt: string,
  result: string,
): void {
  db.prepare(
    `UPDATE instances SET last_check_at = ?, last_check_result = ?, updated_at = ? WHERE id = ?`
  ).run(checkedAt, result, new Date().toISOString(), instanceId);
}
