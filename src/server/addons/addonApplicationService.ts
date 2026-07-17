import { copyFile, mkdir, opendir, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { Database } from "better-sqlite3";
import type { Instance, InstanceAddon, InstanceAddonPack } from "../../shared/types/index.js";
import { getRuntimePaths } from "../config/paths.js";
import { createInternalRevertBackup } from "../instances/instanceBackupService.js";
import { listInstanceAddonPacks, listInstanceAddons, updateInstanceAddonEnablement } from "./addonRepository.js";
import { getAddonDownloadBasePath } from "./addonStoragePaths.js";
import {
  applyManagedPackOrder,
  ensureActiveWorldPath,
  findExistingActiveWorldPath,
  readWorldPackReferences,
  writeWorldPackReferences,
} from "./addonWorldService.js";

export type EnabledAddonApplicationResult = {
  repaired: boolean;
  addonCount: number;
  packCount: number;
  reasons: string[];
};

const legacyDevelopmentDataPrefix = ".runtime/var/lib/chroma/";

function resolveRuntimeManagedPath(path: string): string {
  if (isAbsolute(path)) {
    return resolve(path);
  }

  const normalizedPath = path.replaceAll("\\", "/");
  if (normalizedPath === ".runtime/var/lib/chroma") {
    return getRuntimePaths().dataDir;
  }
  if (normalizedPath.startsWith(legacyDevelopmentDataPrefix)) {
    return resolve(getRuntimePaths().dataDir, normalizedPath.slice(legacyDevelopmentDataPrefix.length));
  }

  return resolve(path);
}

function assertChildPath(parentPath: string, childPath: string): void {
  const relativePath = relative(resolveRuntimeManagedPath(parentPath), resolveRuntimeManagedPath(childPath));
  if (relativePath === "" || relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new Error("Resolved addon path is outside the expected instance directory.");
  }
}

function resolveAddonSourcePath(sourcePath: string): string {
  const resolvedPath = resolveRuntimeManagedPath(sourcePath);
  assertChildPath(getAddonDownloadBasePath(), resolvedPath);
  return resolvedPath;
}

async function pathStatus(path: string): Promise<"missing" | "directory" | "other"> {
  try {
    return (await stat(path)).isDirectory() ? "directory" : "other";
  } catch {
    return "missing";
  }
}

async function pathExists(path: string): Promise<boolean> {
  return (await pathStatus(path)) !== "missing";
}

async function copyDirectoryRecursive(sourceDir: string, destinationDir: string): Promise<void> {
  await mkdir(destinationDir, { recursive: true });

  const directory = await opendir(sourceDir);
  for await (const entry of directory) {
    if (entry.isSymbolicLink()) {
      throw new Error("Addon pack contains a symlink, which is not supported.");
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

export function getImportedPackPath(instance: Instance, pack: InstanceAddonPack): string {
  const version = pack.headerVersion.join("_");
  const folderName = `chroma_${pack.headerUuid}_${version}`;
  const packRoot = pack.packType === "behavior"
    ? join(instance.instancePath, "bds", "behavior_packs")
    : join(instance.instancePath, "bds", "resource_packs");
  const importedPath = join(packRoot, folderName);
  assertChildPath(packRoot, importedPath);
  return importedPath;
}

function sameReferences(
  left: Awaited<ReturnType<typeof readWorldPackReferences>>,
  right: Awaited<ReturnType<typeof readWorldPackReferences>>,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function pushReason(reasons: string[], reason: string): void {
  if (!reasons.includes(reason)) {
    reasons.push(reason);
  }
}

function supportedPacksForAddon(addon: InstanceAddon, packs: InstanceAddonPack[]): InstanceAddonPack[] {
  const supportedPacks = packs.filter((pack) => pack.packType === "behavior" || pack.packType === "resource");

  if (supportedPacks.length === 0) {
    throw new Error(`Enabled addon "${addon.name}" has no behavior or resource packs to apply.`);
  }

  return supportedPacks;
}

export async function applyEnabledAddonsForInstance(
  db: Database,
  instance: Instance,
  options: { createBackup?: boolean } = {},
): Promise<EnabledAddonApplicationResult> {
  const enabledAddons = listInstanceAddons(db, instance.id)
    .filter((addon) => addon.status === "enabled")
    .sort((left, right) => left.sortOrder - right.sortOrder || left.createdAt.localeCompare(right.createdAt));

  if (enabledAddons.length === 0) {
    return {
      repaired: false,
      addonCount: 0,
      packCount: 0,
      reasons: [],
    };
  }

  const reasons: string[] = [];
  const now = new Date().toISOString();
  let backupCreated = false;
  let packCount = 0;

  const markRepair = async (reason: string): Promise<void> => {
    pushReason(reasons, reason);
    if (options.createBackup && !backupCreated) {
      await createInternalRevertBackup(db, instance.id);
      backupCreated = true;
    }
  };

  const existingWorldPath = await findExistingActiveWorldPath(instance);
  if (!existingWorldPath) {
    await markRepair("prepared missing world directory");
  }
  const worldPath = await ensureActiveWorldPath(instance);

  const behaviorJsonPath = join(worldPath, "world_behavior_packs.json");
  const resourceJsonPath = join(worldPath, "world_resource_packs.json");
  const [behaviorFileExists, resourceFileExists] = await Promise.all([
    pathExists(behaviorJsonPath),
    pathExists(resourceJsonPath),
  ]);
  const behaviorReferences = await readWorldPackReferences(behaviorJsonPath);
  const resourceReferences = await readWorldPackReferences(resourceJsonPath);
  const orderedBehaviorPacks: InstanceAddonPack[] = [];
  const orderedResourcePacks: InstanceAddonPack[] = [];

  for (const addon of enabledAddons) {
    const packs = listInstanceAddonPacks(db, instance.id, addon.id);
    const supportedPacks = supportedPacksForAddon(addon, packs);
    const packUpdates: Parameters<typeof updateInstanceAddonEnablement>[3] = [];

    for (const pack of supportedPacks) {
      packCount += 1;
      const importedPath = getImportedPackPath(instance, pack);
      const importedPathStatus = await pathStatus(importedPath);

      if (importedPathStatus === "missing") {
        await markRepair(`restored imported pack files for "${addon.name}"`);
        await copyDirectoryRecursive(resolveAddonSourcePath(pack.sourcePath), importedPath);
      } else if (importedPathStatus !== "directory") {
        throw new Error(`Imported pack path is not a directory: ${importedPath}`);
      }

      if (pack.enabledPath !== importedPath || pack.status !== "enabled" || !pack.enabledAt) {
        await markRepair(`repaired enabled pack metadata for "${addon.name}"`);
        packUpdates.push({
          packId: pack.id,
          status: "enabled",
          enabledPath: importedPath,
          enabledAt: pack.enabledAt ?? now,
        });
      }

      if (pack.packType === "behavior") {
        orderedBehaviorPacks.push(pack);
      } else {
        orderedResourcePacks.push(pack);
      }
    }

    if (packUpdates.length > 0) {
      updateInstanceAddonEnablement(db, addon.id, "enabled", packUpdates, now);
    }
  }

  const nextBehaviorReferences = applyManagedPackOrder(behaviorReferences, orderedBehaviorPacks);
  const nextResourceReferences = applyManagedPackOrder(resourceReferences, orderedResourcePacks);

  if (!behaviorFileExists || !sameReferences(behaviorReferences, nextBehaviorReferences)) {
    await markRepair("repaired world behavior pack references");
    await writeWorldPackReferences(behaviorJsonPath, nextBehaviorReferences);
  }

  if (!resourceFileExists || !sameReferences(resourceReferences, nextResourceReferences)) {
    await markRepair("repaired world resource pack references");
    await writeWorldPackReferences(resourceJsonPath, nextResourceReferences);
  }

  return {
    repaired: reasons.length > 0,
    addonCount: enabledAddons.length,
    packCount,
    reasons,
  };
}
