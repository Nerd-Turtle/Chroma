import { createWriteStream } from "node:fs";
import { copyFile, mkdir, opendir, rm, stat } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import yazl from "yazl";
import type { Database } from "better-sqlite3";
import type { Instance } from "../../shared/types/index.js";
import { createId } from "../utils/createId.js";
import { getInstance } from "./instanceService.js";
import { appendInstanceRuntimeEvent } from "./instanceRuntimeEventService.js";
import { getBdsRuntimeState, sendBdsCommand, setBdsMaintenanceState, startBdsForInstance, stopBdsForInstance } from "../bds/bdsRuntimeService.js";

const CONFIG_FILES_TO_BACKUP = ["server.properties", "allowlist.json", "permissions.json"] as const;
const INTERNAL_BACKUP_PREFIX = "internal";
const EXPORT_BACKUP_PREFIX = "export";
const MAINTENANCE_WARNING_DELAY_MS = 10_000;

export type InstanceBackupMode = "internal" | "export";

export type InstanceBackupRecord = {
  backupId: string;
  fileName: string;
  createdAt: string;
  mode: InstanceBackupMode;
  path: string;
};

function getBackupsRoot(instance: Instance): string {
  return join(instance.instancePath, "csm", "backups");
}

function getBackupPath(instance: Instance, mode: InstanceBackupMode, backupId: string): string {
  return join(getBackupsRoot(instance), mode === "internal" ? INTERNAL_BACKUP_PREFIX : EXPORT_BACKUP_PREFIX, backupId);
}

function getExportZipPath(instance: Instance, backupId: string): string {
  return `${getBackupPath(instance, "export", backupId)}.zip`;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function copyDirectoryRecursive(sourceDir: string, destinationDir: string): Promise<void> {
  await mkdir(destinationDir, { recursive: true });

  const directory = await opendir(sourceDir);
  for await (const entry of directory) {
    const sourcePath = join(sourceDir, entry.name);
    const destinationPath = join(destinationDir, entry.name);

    if (entry.isDirectory()) {
      await copyDirectoryRecursive(sourcePath, destinationPath);
      continue;
    }

    if (entry.isFile()) {
      await mkdir(dirname(destinationPath), { recursive: true });
      await copyFile(sourcePath, destinationPath);
    }
  }
}

async function copyIfPresent(sourcePath: string, destinationPath: string): Promise<void> {
  if (!(await pathExists(sourcePath))) {
    return;
  }

  await mkdir(dirname(destinationPath), { recursive: true });
  await copyFile(sourcePath, destinationPath);
}

async function collectFilesRecursive(rootPath: string): Promise<string[]> {
  const stats = await stat(rootPath);
  if (stats.isFile()) {
    return [rootPath];
  }

  const files: string[] = [];
  const directory = await opendir(rootPath);
  for await (const entry of directory) {
    const entryPath = join(rootPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFilesRecursive(entryPath)));
      continue;
    }

    if (entry.isFile()) {
      files.push(entryPath);
    }
  }

  return files;
}

async function writeZipFromDirectory(sourceDir: string, zipPath: string): Promise<void> {
  const zipFile = new yazl.ZipFile();
  const files = await collectFilesRecursive(sourceDir);

  for (const filePath of files) {
    zipFile.addFile(filePath, relative(sourceDir, filePath));
  }

  await mkdir(dirname(zipPath), { recursive: true });

  await new Promise<void>((resolve, reject) => {
    zipFile.outputStream
      .pipe(createWriteStream(zipPath))
      .on("close", () => resolve())
      .on("error", reject);

    zipFile.end();
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function createInternalRevertBackup(db: Database, instanceId: string): Promise<InstanceBackupRecord> {
  const instance = getInstance(db, instanceId);
  if (!instance) {
    throw new Error("Instance not found");
  }

  const backupId = createId("bk");
  const createdAt = new Date().toISOString();
  const backupPath = getBackupPath(instance, "internal", backupId);
  const bdsDir = join(instance.instancePath, "bds");
  const worldsDir = join(bdsDir, "worlds");

  await mkdir(backupPath, { recursive: true });

  for (const fileName of CONFIG_FILES_TO_BACKUP) {
    await copyIfPresent(join(bdsDir, fileName), join(backupPath, "config", fileName));
  }

  if (await pathExists(worldsDir)) {
    await copyDirectoryRecursive(worldsDir, join(backupPath, "worlds"));
  }

  const record: InstanceBackupRecord = {
    backupId,
    fileName: backupId,
    createdAt,
    mode: "internal",
    path: backupPath,
  };

  await appendInstanceRuntimeEvent(db, instanceId, {
    category: "backup",
    action: "backup_created",
    level: "info",
    message: "Created an internal revert backup.",
    details: {
      backupId,
      mode: "internal",
    },
    createdAt,
  });

  return record;
}

export async function restoreConfigFilesFromInternalBackup(db: Database, instanceId: string, backupId: string): Promise<void> {
  const instance = getInstance(db, instanceId);
  if (!instance) {
    throw new Error("Instance not found");
  }

  const backupPath = getBackupPath(instance, "internal", backupId);
  const configRoot = join(backupPath, "config");
  const bdsDir = join(instance.instancePath, "bds");

  for (const fileName of CONFIG_FILES_TO_BACKUP) {
    await copyIfPresent(join(configRoot, fileName), join(bdsDir, fileName));
  }
}

export async function createExportBackupZip(db: Database, instanceId: string): Promise<InstanceBackupRecord> {
  const instance = getInstance(db, instanceId);
  if (!instance) {
    throw new Error("Instance not found");
  }

  const backupId = createId("bk");
  const createdAt = new Date().toISOString();
  const stagingPath = getBackupPath(instance, "export", backupId);
  const zipPath = getExportZipPath(instance, backupId);
  const fileName = `${instance.friendlyName.replace(/[^a-z0-9._-]+/gi, "_") || "instance"}-${backupId}.zip`;
  const bdsDir = join(instance.instancePath, "bds");
  const worldsDir = join(bdsDir, "worlds");

  await rm(stagingPath, { recursive: true, force: true });
  await mkdir(stagingPath, { recursive: true });

  for (const fileNamePart of CONFIG_FILES_TO_BACKUP) {
    await copyIfPresent(join(bdsDir, fileNamePart), join(stagingPath, "config", fileNamePart));
  }

  if (await pathExists(worldsDir)) {
    await copyDirectoryRecursive(worldsDir, join(stagingPath, "worlds"));
  }

  await writeZipFromDirectory(stagingPath, zipPath);
  await rm(stagingPath, { recursive: true, force: true });

  const record: InstanceBackupRecord = {
    backupId,
    fileName,
    createdAt,
    mode: "export",
    path: zipPath,
  };

  await appendInstanceRuntimeEvent(db, instanceId, {
    category: "backup",
    action: "backup_created",
    level: "info",
    message: "Created an export backup for download.",
    details: {
      backupId,
      mode: "export",
      fileName,
    },
    createdAt,
  });

  return record;
}

export async function createManagedExportBackupZip(db: Database, instanceId: string): Promise<InstanceBackupRecord> {
  const instance = getInstance(db, instanceId);
  if (!instance) {
    throw new Error("Instance not found");
  }

  const runtimeBeforeBackup = await getBdsRuntimeState(db, instanceId);
  const wasRunning = runtimeBeforeBackup.isProcessActive;

  try {
    if (wasRunning) {
      await setBdsMaintenanceState(
        db,
        instanceId,
        "backup",
        "Preparing export backup. The instance will stop briefly for maintenance.",
      );
      sendBdsCommand(instanceId, "say Server maintenance starting for a backup. The server will shut down shortly.");
      await sleep(MAINTENANCE_WARNING_DELAY_MS);
      await stopBdsForInstance(db, instanceId);
    }

    await setBdsMaintenanceState(
      db,
      instanceId,
      "backup",
      wasRunning ? "Creating export backup while the instance is offline." : "Creating export backup.",
    );
    const backup = await createExportBackupZip(db, instanceId);

    if (wasRunning) {
      await setBdsMaintenanceState(db, instanceId, "restore", "Restarting the instance after export backup.");
      await startBdsForInstance(db, instanceId);
    } else {
      await setBdsMaintenanceState(db, instanceId, "idle", "Export backup completed.");
    }

    return backup;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await setBdsMaintenanceState(db, instanceId, "idle", `Export backup failed: ${message}`);
    throw error;
  }
}

export async function getExportBackupRecord(db: Database, instanceId: string, backupId: string): Promise<InstanceBackupRecord> {
  const instance = getInstance(db, instanceId);
  if (!instance) {
    throw new Error("Instance not found");
  }

  const zipPath = getExportZipPath(instance, backupId);
  if (!(await pathExists(zipPath))) {
    throw new Error("Backup not found");
  }

  return {
    backupId,
    fileName: `${instance.friendlyName.replace(/[^a-z0-9._-]+/gi, "_") || "instance"}-${backupId}.zip`,
    createdAt: new Date((await stat(zipPath)).mtimeMs).toISOString(),
    mode: "export",
    path: zipPath,
  };
}
