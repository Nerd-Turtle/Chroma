import type { Database } from "better-sqlite3";
import type { InstanceAddonUpdate } from "../../shared/types/index.js";
import { createId } from "../utils/createId.js";

export type AddonUpdateJob = {
  addon_id: string;
  instance_id: string;
  target_file_id: string;
  previous_file_id: string | null;
  state: InstanceAddonUpdate["state"];
  message: string;
  updated_at: string;
};

export function getAddonUpdateJobs(db: Database, instanceId?: string): AddonUpdateJob[] {
  return db.prepare(`SELECT * FROM addon_instance_updates ${instanceId ? "WHERE instance_id = ?" : ""}`).all(...(instanceId ? [instanceId] : [])) as AddonUpdateJob[];
}

export function saveAddonUpdateJob(db: Database, job: AddonUpdateJob): void {
  db.prepare(`INSERT INTO addon_instance_updates VALUES (@addon_id, @instance_id, @target_file_id, @previous_file_id, @state, @message, @updated_at)
    ON CONFLICT(addon_id) DO UPDATE SET target_file_id=excluded.target_file_id, previous_file_id=excluded.previous_file_id, state=excluded.state, message=excluded.message, updated_at=excluded.updated_at`).run(job);
}

export function setAddonUpdateJobState(db: Database, addonId: string, state: AddonUpdateJob["state"], message: string): void {
  db.prepare("UPDATE addon_instance_updates SET state=?, message=?, updated_at=? WHERE addon_id=?").run(state, message, new Date().toISOString(), addonId);
}

// The source release stays immutable. Only this instance's link and pack rows change.
export function switchInstanceAddonRelease(db: Database, addonId: string, fileId: string): void {
  const file = db.prepare("SELECT * FROM addon_files WHERE id=?").get(fileId) as Record<string, unknown> | undefined;
  const addon = db.prepare("SELECT * FROM instance_addons WHERE id=?").get(addonId) as Record<string, unknown> | undefined;
  if (!file || !addon) throw new Error("The addon or downloaded release is no longer available.");
  if (file.provider !== addon.provider || file.provider_project_id !== addon.provider_project_id) throw new Error("The selected release belongs to another addon.");
  const packs = db.prepare("SELECT * FROM addon_file_packs WHERE addon_file_id=?").all(fileId) as Array<Record<string, unknown>>;
  db.transaction(() => {
    const fields = ["provider_file_id", "name", "slug", "summary", "website_url", "logo_url", "file_name", "file_display_name", "file_date", "download_count", "workspace_path", "archive_path", "extracted_path", "provider_metadata_json", "error"];
    db.prepare(`UPDATE instance_addons SET addon_file_id=?, library_sync_status='linked', library_sync_message=NULL, ${fields.map((field) => `${field}=?`).join(",")}, updated_at=? WHERE id=?`)
      .run(fileId, ...fields.map((field) => file[field] ?? null), new Date().toISOString(), addonId);
    db.prepare("DELETE FROM instance_addon_packs WHERE addon_id=?").run(addonId);
    for (const pack of packs) {
      db.prepare(`INSERT INTO instance_addon_packs (id,instance_id,addon_id,addon_file_pack_id,pack_type,name,description,header_uuid,header_version_json,min_engine_version_json,source_path,status,manifest_json,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(createId("pack"), addon.instance_id, addonId, pack.id, pack.pack_type, pack.name, pack.description, pack.header_uuid, pack.header_version_json, pack.min_engine_version_json, pack.source_path, addon.status === "enabled" ? "enabled" : addon.status === "disabled" ? "disabled" : "downloaded", pack.manifest_json, new Date().toISOString(), new Date().toISOString());
    }
  })();
}
