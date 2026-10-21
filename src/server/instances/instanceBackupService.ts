import { runInstanceMutation } from "./addonUpdateControl.js";
import { createWriteStream } from "node:fs";
import { copyFile, mkdir, opendir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, normalize, relative, resolve } from "node:path";
import yazl from "yazl";
import yauzl from "yauzl";
import type { Database } from "better-sqlite3";
import type { AddonLibraryItem, BedrockServerSettings, BdsInstall, Instance, InstanceAddon, InstanceAddonPack } from "../../shared/types/index.js";
import { createId } from "../utils/createId.js";
import { getInstance } from "./instanceService.js";
import { saveInstance, deleteInstanceById } from "./instanceRepository.js";
import { createInstanceDirectories, deleteInstanceDirectory } from "./instanceFilesystem.js";
import { appendInstanceRuntimeEvent } from "./instanceRuntimeEventService.js";
import { getBdsRuntimeState, sendBdsCommand, setBdsMaintenanceState, startBdsForInstance, stopBdsForInstance } from "../bds/bdsRuntimeService.js";
import { getBdsInstall, saveBdsInstall } from "../bds/bdsRepository.js";
import { getSettings } from "./instanceSettingsService.js";
import { saveInstanceSettings } from "./instanceSettingsRepository.js";
import { getRuntimePaths } from "../config/paths.js";
import { getAddonFileByProviderFile, listAddonFilePacks, listInstanceAddonPacks, saveInstanceAddonWithPacks, saveRestoredInstanceAddonWithPacks, type SaveInstanceAddonInput, type SaveInstanceAddonPackInput } from "../addons/addonRepository.js";
import { listAddonsForInstance } from "../addons/addonService.js";

const CONFIG_FILES_TO_BACKUP = ["server.properties", "allowlist.json", "permissions.json"] as const;
const INTERNAL_BACKUP_PREFIX = "internal";
const EXPORT_BACKUP_PREFIX = "export";
const MAINTENANCE_WARNING_DELAY_MS = 10_000;
const FULL_BACKUP_MANIFEST_FILE = "chroma-instance-backup.json";
const FULL_BACKUP_SCHEMA_VERSION = 1;
const MAX_IMPORT_ARCHIVE_ENTRIES = 50_000;
const MAX_IMPORT_EXTRACTED_BYTES = 16 * 1024 * 1024 * 1024;

export type InstanceBackupMode = "internal" | "export";

export type InstanceBackupRecord = {
  backupId: string;
  fileName: string;
  createdAt: string;
  mode: InstanceBackupMode;
  path: string;
};

type BackupPack = InstanceAddonPack & {
  backupSourcePath?: string;
  enabledPathRelative?: string;
};

type BackupAddon = {
  addon: InstanceAddon;
  packs: BackupPack[];
};

type FullInstanceBackupManifest = {
  format: "chroma-instance-backup";
  schemaVersion: number;
  createdAt: string;
  instance: Omit<Instance, "id" | "instancePath" | "createdAt" | "updatedAt" | "status">;
  bdsInstall?: Omit<BdsInstall, "instanceId">;
  settings?: Omit<BedrockServerSettings, "instanceId">;
  addons: BackupAddon[];
};

export type ImportedInstanceBackup = {
  instance: Instance;
  missingLibraryAddonNames: string[];
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
    if (entry.isSymbolicLink()) {
      throw new Error("Backup files may not contain symlinks.");
    }
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

function safeArchivePath(destination: string, entryName: string): string {
  // CWE-22: backup manifests and ZIP entry names cannot choose paths outside staging.
  // https://cwe.mitre.org/data/definitions/22.html
  const normalized = normalize(entryName);
  if (normalized === "" || isAbsolute(normalized) || normalized.startsWith("..")) {
    throw new Error("Backup archive contains an invalid path.");
  }

  const outputPath = resolve(destination, normalized);
  const outputRelativePath = relative(resolve(destination), outputPath);
  if (outputRelativePath.startsWith("..") || isAbsolute(outputRelativePath)) {
    throw new Error("Backup archive contains an invalid path.");
  }

  return outputPath;
}

function isZipSymlink(entry: yauzl.Entry): boolean {
  return ((entry.externalFileAttributes >> 16) & 0o170000) === 0o120000;
}

async function extractBackupZip(zipPath: string, destination: string): Promise<void> {
  await mkdir(destination, { recursive: true });

  await new Promise<void>((resolvePromise, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (openError, zipFile) => {
      if (openError || !zipFile) {
        reject(openError ?? new Error("Unable to open backup archive."));
        return;
      }

      let entryCount = 0;
      let extractedBytes = 0;
      let settled = false;
      const fail = (error: Error) => {
        if (!settled) {
          settled = true;
          zipFile.close();
          reject(error);
        }
      };

      zipFile.readEntry();
      zipFile.on("entry", (entry) => {
        if (settled) return;
        entryCount += 1;
        extractedBytes += entry.uncompressedSize;
        if (entryCount > MAX_IMPORT_ARCHIVE_ENTRIES || extractedBytes > MAX_IMPORT_EXTRACTED_BYTES) {
          fail(new Error("Backup archive is larger than Chroma currently allows."));
          return;
        }
        if (isZipSymlink(entry)) {
          fail(new Error("Backup archive contains a symlink, which is not supported."));
          return;
        }
        if (entry.fileName.endsWith("/")) {
          let directoryPath: string;
          try {
            directoryPath = safeArchivePath(destination, entry.fileName);
          } catch (error) {
            fail(error instanceof Error ? error : new Error(String(error)));
            return;
          }
          void mkdir(directoryPath, { recursive: true })
            .then(() => zipFile.readEntry())
            .catch((error: unknown) => fail(error instanceof Error ? error : new Error(String(error))));
          return;
        }

        let outputPath: string;
        try {
          outputPath = safeArchivePath(destination, entry.fileName);
        } catch (error) {
          fail(error instanceof Error ? error : new Error(String(error)));
          return;
        }

        zipFile.openReadStream(entry, (streamError, readStream) => {
          if (streamError || !readStream) {
            fail(streamError ?? new Error("Unable to read a backup archive entry."));
            return;
          }
          void mkdir(dirname(outputPath), { recursive: true })
            .then(() => new Promise<void>((entryResolve, entryReject) => {
              const output = createWriteStream(outputPath, { flags: "wx" });
              readStream.on("error", entryReject);
              output.on("error", entryReject);
              output.on("close", entryResolve);
              readStream.pipe(output);
            }))
            .then(() => zipFile.readEntry())
            .catch((error: unknown) => fail(error instanceof Error ? error : new Error(String(error))));
        });
      });
      zipFile.on("end", () => {
        if (!settled) {
          settled = true;
          resolvePromise();
        }
      });
      zipFile.on("error", (error) => fail(error));
    });
  });
}

function buildMissingAddonMessage(addonName: string): string {
  return `This addon was restored from the backup but is not in Chroma's Addon Library. Download ${addonName} to synchronize future management and updates.`;
}

function restoredAddonPathPart(value: string): string {
  const safeValue = value.replace(/[^a-zA-Z0-9._-]/g, "_");
  return safeValue.length > 0 ? safeValue : "restored-addon";
}

function validateFullBackupManifest(value: unknown): FullInstanceBackupManifest {
  if (!value || typeof value !== "object") {
    throw new Error("Backup manifest is invalid.");
  }
  const manifest = value as Partial<FullInstanceBackupManifest>;
  if (manifest.format !== "chroma-instance-backup" || manifest.schemaVersion !== FULL_BACKUP_SCHEMA_VERSION) {
    throw new Error("This is not a supported Chroma full instance backup.");
  }
  if (!manifest.instance || typeof manifest.instance.friendlyName !== "string" || typeof manifest.instance.bdsVersion !== "string") {
    throw new Error("Backup manifest does not contain a valid instance.");
  }
  if (!Array.isArray(manifest.addons)) {
    throw new Error("Backup manifest does not contain addon data.");
  }
  return manifest as FullInstanceBackupManifest;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function createInternalRevertBackup(db: Database, instanceId: string): Promise<InstanceBackupRecord> {
  // CIS Control 11 (Data Recovery): keep a recovery copy before changing worlds/configuration.
  // https://www.cisecurity.org/controls/data-recovery
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

  await rm(stagingPath, { recursive: true, force: true });
  await mkdir(stagingPath, { recursive: true });

  if (await pathExists(bdsDir)) {
    await copyDirectoryRecursive(bdsDir, join(stagingPath, "instance", "bds"));
  }

  const addonSnapshots: BackupAddon[] = [];
  for (const addon of listAddonsForInstance(db, instanceId)) {
    const packs = listInstanceAddonPacks(db, instanceId, addon.id);
    const backupPacks: BackupPack[] = [];

    for (const pack of packs) {
      const backupSourcePath = join("addon-sources", addon.id, pack.id);
      const sourcePath = pack.sourcePath;
      if (await pathExists(sourcePath)) {
        await copyDirectoryRecursive(sourcePath, join(stagingPath, backupSourcePath));
      }

      const enabledPathRelative = pack.enabledPath
        ? relative(instance.instancePath, pack.enabledPath)
        : undefined;
      backupPacks.push({
        ...pack,
        ...(backupSourcePath ? { backupSourcePath } : {}),
        ...(enabledPathRelative ? { enabledPathRelative } : {}),
      });
    }

    if (addon.archivePath && await pathExists(addon.archivePath)) {
      await copyIfPresent(addon.archivePath, join(stagingPath, "addon-archives", addon.id, basename(addon.archivePath)));
    }

    addonSnapshots.push({ addon, packs: backupPacks });
  }

  const { id: _instanceId, instancePath: _instancePath, status: _status, createdAt: _createdAt, updatedAt: _updatedAt, ...instanceSnapshot } = instance;
  const bdsInstall = getBdsInstall(db, instanceId);
  const settings = getSettings(db, instanceId);
  const manifest: FullInstanceBackupManifest = {
    format: "chroma-instance-backup",
    schemaVersion: FULL_BACKUP_SCHEMA_VERSION,
    createdAt,
    instance: instanceSnapshot,
    ...(bdsInstall ? { bdsInstall: (() => { const { instanceId: _ignored, ...snapshot } = bdsInstall; return snapshot; })() } : {}),
    ...(settings ? { settings: (() => { const { instanceId: _ignored, ...snapshot } = settings; return snapshot; })() } : {}),
    addons: addonSnapshots,
  };
  await mkdir(stagingPath, { recursive: true });
  await writeFile(join(stagingPath, FULL_BACKUP_MANIFEST_FILE), JSON.stringify(manifest, null, 2), "utf8");

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

async function createManagedExportBackupZipUnlocked(db: Database, instanceId: string): Promise<InstanceBackupRecord> {
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

async function hasUsableLibraryAddon(db: Database, addon: InstanceAddon): Promise<boolean> {
  const libraryAddon = getAddonFileByProviderFile(db, addon.provider, addon.providerProjectId, addon.providerFileId);
  if (!libraryAddon) return false;
  const packs = listAddonFilePacks(db, libraryAddon.id);
  if (packs.length === 0) return false;
  for (const pack of packs) {
    if (!(await pathExists(pack.sourcePath))) return false;
  }
  return true;
}

function makeImportedInstance(manifest: FullInstanceBackupManifest): Instance {
  const now = new Date().toISOString();
  const id = createId("inst");
  const runtimePaths = getRuntimePaths();
  return {
    id,
    friendlyName: `${manifest.instance.friendlyName} (Imported)`,
    status: "stopped",
    bdsVersion: manifest.instance.bdsVersion,
    automaticUpdatesEnabled: manifest.instance.automaticUpdatesEnabled,
    updateCheckFrequency: manifest.instance.updateCheckFrequency,
    updateCheckTime: manifest.instance.updateCheckTime,
    updateCheckWeekday: manifest.instance.updateCheckWeekday,
    instancePath: join(runtimePaths.dataDir, "instances", id),
    ...(manifest.instance.activeWorldName ? { activeWorldName: manifest.instance.activeWorldName } : {}),
    lastCheckAt: now,
    lastCheckResult: "Imported from backup",
    createdAt: now,
    updatedAt: now,
  };
}

function makeLinkedAddonInput(
  instance: Instance,
  backupAddon: BackupAddon,
  libraryAddon: AddonLibraryItem,
): SaveInstanceAddonInput {
  const { addon } = backupAddon;
  const now = new Date().toISOString();
  const {
    addonFileId: _oldAddonFileId,
    librarySyncStatus: _oldLibrarySyncStatus,
    librarySyncMessage: _oldLibrarySyncMessage,
    workspacePath: _oldWorkspacePath,
    archivePath: _oldArchivePath,
    extractedPath: _oldExtractedPath,
    ...addonSnapshot
  } = addon;
  return {
    ...addonSnapshot,
    id: createId("addon"),
    instanceId: instance.id,
    addonFileId: libraryAddon.id,
    librarySyncStatus: "linked",
    workspacePath: libraryAddon.workspacePath,
    ...(libraryAddon.archivePath ? { archivePath: libraryAddon.archivePath } : {}),
    ...(libraryAddon.extractedPath ? { extractedPath: libraryAddon.extractedPath } : {}),
    createdAt: now,
    updatedAt: now,
  };
}

function makeRestoredAddonInput(instance: Instance, backupAddon: BackupAddon): SaveInstanceAddonInput {
  const { addon } = backupAddon;
  const now = new Date().toISOString();
  return {
    ...addon,
    id: createId("addon"),
    instanceId: instance.id,
    librarySyncStatus: "missing",
    librarySyncMessage: buildMissingAddonMessage(addon.name),
    workspacePath: join(instance.instancePath, "csm", "restored-addons", restoredAddonPathPart(addon.id)),
    createdAt: now,
    updatedAt: now,
  };
}

function makeRestoredPackInputs(instance: Instance, addonId: string, backupAddon: BackupAddon): SaveInstanceAddonPackInput[] {
  const now = new Date().toISOString();
  return backupAddon.packs.map((pack) => ({
    id: createId("pack"),
    instanceId: instance.id,
    addonId,
    packType: pack.packType,
    ...(pack.name ? { name: pack.name } : {}),
    ...(pack.description ? { description: pack.description } : {}),
    headerUuid: pack.headerUuid,
    headerVersionJson: JSON.stringify(pack.headerVersion),
    ...(pack.minEngineVersion ? { minEngineVersionJson: JSON.stringify(pack.minEngineVersion) } : {}),
    sourcePath: join(
      instance.instancePath,
      "csm",
      "restored-addons",
      restoredAddonPathPart(backupAddon.addon.id),
      restoredAddonPathPart(pack.id),
    ),
    ...(pack.enabledPathRelative ? { enabledPath: safeArchivePath(instance.instancePath, pack.enabledPathRelative) } : {}),
    status: pack.status,
    ...(pack.enabledAt ? { enabledAt: pack.enabledAt } : {}),
    ...(pack.disabledAt ? { disabledAt: pack.disabledAt } : {}),
    createdAt: now,
    updatedAt: now,
  }));
}

/**
 * Imports a full, self-contained instance backup. Missing Addon Library
 * records do not block the import: the preserved backup source remains tied
 * to the imported instance and is marked for later library synchronization.
 */
export async function importInstanceBackupZip(db: Database, uploadedZipPath: string): Promise<ImportedInstanceBackup> {
  const importId = createId("import");
  const stagingPath = join(getRuntimePaths().dataDir, "imports", importId);
  let importedInstance: Instance | undefined;

  try {
    await extractBackupZip(uploadedZipPath, stagingPath);
    const manifest = validateFullBackupManifest(JSON.parse(await readFile(join(stagingPath, FULL_BACKUP_MANIFEST_FILE), "utf8")) as unknown);
    const stagedBdsPath = join(stagingPath, "instance", "bds");
    if (!(await pathExists(stagedBdsPath))) {
      throw new Error("Backup does not contain the instance BDS files.");
    }

    const restoredInstance = makeImportedInstance(manifest);
    importedInstance = restoredInstance;
    await createInstanceDirectories(restoredInstance);
    await copyDirectoryRecursive(stagedBdsPath, join(restoredInstance.instancePath, "bds"));
    if (await pathExists(join(stagingPath, "addon-sources"))) {
      await copyDirectoryRecursive(join(stagingPath, "addon-sources"), join(restoredInstance.instancePath, "csm", "restored-addons"));
    }

    saveInstance(db, restoredInstance);
    if (manifest.bdsInstall) {
      saveBdsInstall(db, { ...manifest.bdsInstall, instanceId: restoredInstance.id, updatedAt: new Date().toISOString() });
    }
    if (manifest.settings) {
      saveInstanceSettings(db, { ...manifest.settings, instanceId: restoredInstance.id, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    }

    const missingLibraryAddonNames: string[] = [];
    for (const backupAddon of manifest.addons) {
      const libraryAddon = getAddonFileByProviderFile(
        db,
        backupAddon.addon.provider,
        backupAddon.addon.providerProjectId,
        backupAddon.addon.providerFileId,
      );
      const linked = libraryAddon && await hasUsableLibraryAddon(db, backupAddon.addon);

      if (linked && libraryAddon) {
        const addon = makeLinkedAddonInput(restoredInstance, backupAddon, libraryAddon);
        const now = new Date().toISOString();
        const libraryPacks = listAddonFilePacks(db, libraryAddon.id);
        const packs: SaveInstanceAddonPackInput[] = libraryPacks.map((pack) => {
          const sourcePack = backupAddon.packs.find((candidate) =>
            candidate.packType === pack.packType &&
            candidate.headerUuid.toLowerCase() === pack.headerUuid.toLowerCase() &&
            JSON.stringify(candidate.headerVersion) === pack.headerVersionJson,
          );
          return {
            ...pack,
            id: createId("pack"),
            instanceId: restoredInstance.id,
            addonId: addon.id,
            status: sourcePack?.status ?? "downloaded",
            ...(sourcePack?.enabledPathRelative ? { enabledPath: safeArchivePath(restoredInstance.instancePath, sourcePack.enabledPathRelative) } : {}),
            createdAt: now,
            updatedAt: now,
          };
        });
        saveInstanceAddonWithPacks(db, addon, packs);
      } else {
        const addon = makeRestoredAddonInput(restoredInstance, backupAddon);
        const packs = makeRestoredPackInputs(restoredInstance, addon.id, backupAddon);
        saveRestoredInstanceAddonWithPacks(db, addon, packs);
        missingLibraryAddonNames.push(addon.name);
      }
    }

    await appendInstanceRuntimeEvent(db, restoredInstance.id, {
      category: "backup",
      action: "backup_imported",
      level: missingLibraryAddonNames.length > 0 ? "warning" : "info",
      message: missingLibraryAddonNames.length > 0
        ? `Imported backup with ${missingLibraryAddonNames.length} addon${missingLibraryAddonNames.length === 1 ? "" : "s"} not yet in the Addon Library.`
        : "Imported full instance backup.",
      details: { missingLibraryAddonNames },
    });

    return { instance: restoredInstance, missingLibraryAddonNames };
  } catch (error) {
    if (importedInstance) {
      deleteInstanceById(db, importedInstance.id);
      await deleteInstanceDirectory(importedInstance);
    }
    throw error;
  } finally {
    await rm(stagingPath, { recursive: true, force: true });
  }
}

export async function createManagedExportBackupZip(db: Database, instanceId: string): Promise<InstanceBackupRecord> {
  const instance = getInstance(db, instanceId);
  if (!instance) throw new Error("Instance not found");
  return runInstanceMutation(instance, () => createManagedExportBackupZipUnlocked(db, instanceId));
}
