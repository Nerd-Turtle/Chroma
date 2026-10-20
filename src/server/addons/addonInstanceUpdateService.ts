import type { Database } from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readdir, rename, rm, writeFile, copyFile } from "node:fs/promises";
import { isAbsolute, join, relative, dirname } from "node:path";
import type { Instance, InstanceAddonPack } from "../../shared/types/index.js";
import { getInstance } from "../instances/instanceService.js";
import { createInternalRevertBackup } from "../instances/instanceBackupService.js";
import { getBdsRuntimeState, setBdsMaintenanceState, stopBdsForInstance } from "../bds/bdsRuntimeService.js";
import { appendInstanceRuntimeEvent } from "../instances/instanceRuntimeEventService.js";
import { getAddonUpdateJournalPath, runInstanceMutation } from "../instances/addonUpdateControl.js";
import { getInstanceAddon, listInstanceAddonPacks, listInstanceAddons, listAddonFilePacks } from "./addonRepository.js";
import { applyManagedPackOrder, findExistingActiveWorldPath, readWorldPackReferences } from "./addonWorldService.js";
import { getImportedPackPath, resolveAddonSourcePath } from "./addonApplicationService.js";
import { getAddonUpdateCompatibilityIssue, readReleaseFiles } from "./addonUpdateCompatibility.js";
import { getAddonUpdateJobs, setAddonUpdateJobState, switchInstanceAddonRelease, type AddonUpdateJob } from "./addonUpdateRepository.js";
import { listAddonFileDownloads } from "./addonRepository.js";
import { verifyDownloadedAddon } from "./addonDownloadService.js";

type Journal = {
  id: string;
  addonId: string;
  phase: "prepared" | "committed";
  addon: Record<string, unknown>;
  packs: Array<Record<string, unknown>>;
  moves: Array<{ path: string; existed: boolean }>;
  references: Array<{ path: string; content: string | null }>;
};

async function exists(path: string): Promise<boolean> {
  try { await lstat(path); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
}

async function copyDirectory(source: string, destination: string): Promise<void> {
  if (!(await lstat(source)).isDirectory()) throw new Error("Addon source must be a directory, without symlinks.");
  await mkdir(destination, { recursive: true });
  for (const entry of await readdir(source, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error("Addon files cannot contain symlinks.");
    if (entry.isDirectory()) await copyDirectory(join(source, entry.name), join(destination, entry.name));
    else if (entry.isFile()) await copyFile(join(source, entry.name), join(destination, entry.name));
    else throw new Error("Addon files must be regular files or directories.");
  }
}

async function atomicWrite(path: string, content: string): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try { await writeFile(temporary, content, { flag: "wx" }); await rename(temporary, path); }
  finally { await rm(temporary, { force: true }); }
}

function instancePath(instance: Instance, path: string): string {
  if (isAbsolute(path) || path.split(/[\\/]/).some((part) => part === "..") || !path.startsWith("bds/")) throw new Error("Invalid addon recovery path.");
  return join(instance.instancePath, path);
}

function workPath(instance: Instance, journal: Journal): string {
  if (!/^[0-9a-f-]{36}$/.test(journal.id)) throw new Error("Invalid addon recovery identifier.");
  return join(instance.instancePath, "csm/addon-updates", journal.id);
}

function saveJournal(instance: Instance, journal: Journal): Promise<void> {
  return atomicWrite(getAddonUpdateJournalPath(instance), JSON.stringify(journal));
}

async function assertNoSymlinks(instance: Instance, path: string): Promise<void> {
  const parts = relative(instance.instancePath, path).split(/[\\/]/);
  if (parts.some((part) => part === "..") || isAbsolute(relative(instance.instancePath, path))) throw new Error("Invalid addon recovery path.");
  let current = instance.instancePath;
  for (const part of ["", ...parts]) {
    current = join(current, part);
    try {
      if ((await lstat(current)).isSymbolicLink()) throw new Error("Addon update paths cannot contain symlinks.");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
  }
}

// Validate the whole recovery record before restoring any files or database rows.
async function validateJournal(db: Database, instance: Instance, journal: Journal): Promise<void> {
  if (!journal || !["prepared", "committed"].includes(journal.phase) || !journal.addon || !Array.isArray(journal.packs)
    || !Array.isArray(journal.moves) || !Array.isArray(journal.references)
    || journal.addon.id !== journal.addonId || journal.addon.instance_id !== instance.id
    || !getInstanceAddon(db, instance.id, journal.addonId)
    || journal.packs.some((pack) => !pack || pack.addon_id !== journal.addonId || pack.instance_id !== instance.id)) {
    throw new Error("Invalid addon recovery metadata.");
  }
  const directory = workPath(instance, journal);
  await assertNoSymlinks(instance, directory);
  for (const move of journal.moves) {
    if (!move || typeof move.existed !== "boolean" || !/^bds\/(behavior_packs|resource_packs)\/chroma_[0-9a-f-]+_[\d_]+$/i.test(move.path)) throw new Error("Invalid addon recovery pack path.");
    await assertNoSymlinks(instance, instancePath(instance, move.path));
    await assertNoSymlinks(instance, join(directory, "previous", move.path));
  }
  for (const reference of journal.references) {
    if (!reference || !/^bds\/worlds\/.+\/world_(behavior|resource)_packs\.json$/.test(reference.path)
      || (reference.content !== null && typeof reference.content !== "string")) throw new Error("Invalid addon recovery world path.");
    await assertNoSymlinks(instance, instancePath(instance, reference.path));
  }
}

async function rollback(db: Database, instance: Instance, journal: Journal): Promise<void> {
  await validateJournal(db, instance, journal);
  const directory = workPath(instance, journal);
  for (const move of journal.moves) {
    const destination = instancePath(instance, move.path);
    const previous = join(directory, "previous", move.path);
    if (await exists(previous)) {
      await rm(destination, { recursive: true, force: true });
      await rename(previous, destination);
    } else if (!move.existed) await rm(destination, { recursive: true, force: true });
  }
  for (const reference of journal.references) {
    const path = instancePath(instance, reference.path);
    if (reference.content === null) await rm(path, { force: true });
    else await atomicWrite(path, reference.content);
  }
  db.transaction(() => {
    for (const table of ["instance_addons", "instance_addon_packs"] as const) {
      const rows = table === "instance_addons" ? [journal.addon] : journal.packs;
      const columns = (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((column) => column.name);
      if (table === "instance_addon_packs") db.prepare("DELETE FROM instance_addon_packs WHERE addon_id=?").run(journal.addonId);
      for (const row of rows) {
        if (table === "instance_addons") {
          const fields = columns.filter((column) => column !== "id");
          db.prepare(`UPDATE instance_addons SET ${fields.map((column) => `${column}=?`).join(",")} WHERE id=?`).run(...fields.map((column) => row[column] ?? null), journal.addonId);
        } else db.prepare(`INSERT INTO instance_addon_packs (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`).run(...columns.map((column) => row[column] ?? null));
      }
    }
  })();
}

export async function applyInstanceAddonUpdate(db: Database, job: AddonUpdateJob): Promise<void> {
  const instance = getInstance(db, job.instance_id);
  if (!instance) return;
  await runInstanceMutation(instance, async () => {
    const runtime = await getBdsRuntimeState(db, instance.id);
    if (runtime.isProcessActive || runtime.status !== "stopped" || runtime.maintenanceStatus !== "idle") return;
    const addon = getInstanceAddon(db, instance.id, job.addon_id);
    if (!addon || !addon.autoUpdateEnabled || !instance.automaticUpdatesEnabled) return;
    const issue = getAddonUpdateCompatibilityIssue(db, instance, addon, job.target_file_id);
    if (issue) { setAddonUpdateJobState(db, addon.id, "review", issue); return; }
    await setBdsMaintenanceState(db, instance.id, "backup", `Preparing an addon update for ${addon.name}.`);
    let journal: Journal | undefined;
    let journalWritten = false;
    try {
      const providerFiles = readReleaseFiles(db, job.target_file_id);
      for (const download of listAddonFileDownloads(db, job.target_file_id)) {
        const metadata = providerFiles.find((file) => String(file.id) === download.providerFileId);
        if (!metadata || !download.archivePath || !await verifyDownloadedAddon(download.archivePath, metadata)) throw new Error("The downloaded addon archive failed checksum verification.");
      }
      await createInternalRevertBackup(db, instance.id);
      journal = {
        id: randomUUID(), addonId: addon.id, phase: "prepared",
        addon: db.prepare("SELECT * FROM instance_addons WHERE id=?").get(addon.id) as Record<string, unknown>,
        packs: db.prepare("SELECT * FROM instance_addon_packs WHERE addon_id=?").all(addon.id) as Array<Record<string, unknown>>,
        moves: [], references: [],
      };
      const directory = workPath(instance, journal);
      await assertNoSymlinks(instance, directory);
      await mkdir(directory, { recursive: true });
      const oldPacks = listInstanceAddonPacks(db, instance.id, addon.id);
      const newPacks: InstanceAddonPack[] = listAddonFilePacks(db, job.target_file_id).map((pack) => ({
        id: pack.id, addonId: addon.id, instanceId: instance.id, packType: pack.packType,
        headerUuid: pack.headerUuid, headerVersion: JSON.parse(pack.headerVersionJson) as number[],
        sourcePath: pack.sourcePath, status: addon.status === "enabled" ? "enabled" : "downloaded",
        createdAt: pack.createdAt, updatedAt: pack.updatedAt,
      }));
      if (addon.status === "enabled") {
        const world = await findExistingActiveWorldPath(instance);
        if (!world) throw new Error("The active world is unavailable; the addon was not changed.");
        for (const type of ["behavior", "resource"] as const) {
          const path = join(world, `world_${type}_packs.json`);
          await assertNoSymlinks(instance, path);
          journal.references.push({ path: relative(instance.instancePath, path), content: await exists(path) ? await readFile(path, "utf8") : null });
        }
        for (const pack of newPacks) await copyDirectory(resolveAddonSourcePath(instance, pack.sourcePath), join(directory, "staged", relative(instance.instancePath, getImportedPackPath(instance, pack))));
        for (const path of new Set([...oldPacks, ...newPacks].map((pack) => relative(instance.instancePath, getImportedPackPath(instance, pack))))) {
          journal.moves.push({ path, existed: await exists(instancePath(instance, path)) });
        }
      }
      await validateJournal(db, instance, journal);
      await saveJournal(instance, journal);
      journalWritten = true;
      setAddonUpdateJobState(db, addon.id, "applying", "Applying the downloaded addon release.");
      await setBdsMaintenanceState(db, instance.id, "update", `Updating ${addon.name}.`);
      for (const move of journal.moves) {
        if (move.existed) {
          const previous = join(directory, "previous", move.path);
          await mkdir(dirname(previous), { recursive: true });
          await rename(instancePath(instance, move.path), previous);
        }
      }
      for (const pack of addon.status === "enabled" ? newPacks : []) {
        const destination = getImportedPackPath(instance, pack);
        await mkdir(dirname(destination), { recursive: true });
        await rename(join(directory, "staged", relative(instance.instancePath, destination)), destination);
      }
      for (const reference of journal.references) {
        const type = reference.path.endsWith("world_behavior_packs.json") ? "behavior" : "resource";
        const before = await readWorldPackReferences(instancePath(instance, reference.path));
        const retained = before.filter((entry) => !oldPacks.some((pack) => pack.packType === type && pack.headerUuid.toLowerCase() === entry.pack_id.toLowerCase() && JSON.stringify(pack.headerVersion) === JSON.stringify(entry.version)));
        const ordered = listInstanceAddons(db, instance.id).filter((item) => item.status === "enabled").sort((a, b) => a.sortOrder - b.sortOrder)
          .flatMap((item) => item.id === addon.id ? newPacks : listInstanceAddonPacks(db, instance.id, item.id)).filter((pack) => pack.packType === type);
        await atomicWrite(instancePath(instance, reference.path), JSON.stringify(applyManagedPackOrder(retained, ordered), null, 2) + "\n");
      }
      db.transaction(() => {
        switchInstanceAddonRelease(db, addon.id, job.target_file_id);
        if (addon.status === "enabled") {
          for (const pack of listInstanceAddonPacks(db, instance.id, addon.id)) db.prepare("UPDATE instance_addon_packs SET enabled_path=?, enabled_at=? WHERE id=?").run(getImportedPackPath(instance, pack), new Date().toISOString(), pack.id);
        }
      })();
      await saveJournal(instance, { ...journal, phase: "committed" });
      journal.phase = "committed";
      await atomicWrite(join(directory, "journal.json"), JSON.stringify(journal)).catch(() => undefined);
      setAddonUpdateJobState(db, addon.id, "succeeded", "The addon was updated. Previous files and the world backup were retained.");
      await rm(getAddonUpdateJournalPath(instance));
      journalWritten = false;
      await appendInstanceRuntimeEvent(db, instance.id, { category: "update", action: "addon_update_completed", level: "info", message: `Updated ${addon.name}.`, details: { addonId: addon.id, targetFileId: job.target_file_id } }).catch(() => undefined);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Addon update failed.";
      if (journal?.phase === "committed") {
        setAddonUpdateJobState(db, addon.id, "failed", "The new addon version was installed, but recovery cleanup is pending. Retry to finish cleanup.");
        throw error;
      }
      try {
        if (journalWritten && journal) {
          await rollback(db, instance, journal);
          await rm(getAddonUpdateJournalPath(instance), { force: true });
          journalWritten = false;
        }
        setAddonUpdateJobState(db, addon.id, "failed", `${message} Previous instance files and links were preserved. Retry manually.`);
      } catch {
        setAddonUpdateJobState(db, addon.id, "failed", "Addon recovery could not finish. Instance starts are blocked until recovery succeeds.");
      }
      throw error;
    } finally {
      if (!journalWritten) await setBdsMaintenanceState(db, instance.id, "idle");
    }
  });
}

export async function recoverInstanceAddonUpdate(db: Database, instance: Instance): Promise<void> {
  const path = getAddonUpdateJournalPath(instance);
  if (!await exists(path)) return;
  await runInstanceMutation(instance, async () => {
    let journal: Journal | undefined;
    try {
      const runtime = await getBdsRuntimeState(db, instance.id);
      if (runtime.isProcessActive) throw new Error("Stop the instance before recovering an interrupted addon update.");
      await assertNoSymlinks(instance, path);
      journal = JSON.parse(await readFile(path, "utf8")) as Journal;
      await validateJournal(db, instance, journal);
      if (journal.phase !== "committed") await rollback(db, instance, journal);
      setAddonUpdateJobState(db, journal.addonId, journal.phase === "committed" ? "succeeded" : "failed", journal.phase === "committed" ? "The addon update completed before Chroma restarted." : "An interrupted update was restored to its previous version. Retry manually.");
      await rm(path);
      await stopBdsForInstance(db, instance.id);
      await setBdsMaintenanceState(db, instance.id, "idle", "Addon update recovery completed.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Recovery failed.";
      for (const job of getAddonUpdateJobs(db, instance.id).filter((item) => item.state === "applying" || item.addon_id === journal?.addonId)) {
        setAddonUpdateJobState(db, job.addon_id, "failed", `Addon recovery is blocked: ${message} Correct the issue, then retry. Instance starts remain blocked.`);
      }
      throw error;
    }
  }, true);
}
