import { copyFile, mkdir, opendir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative } from "node:path";
import type { Database } from "better-sqlite3";
import type { Instance, InstanceAddon, InstanceAddonPack } from "../../shared/types/index.js";
import { getBdsRuntimeState } from "../bds/bdsRuntimeService.js";
import { createInternalRevertBackup } from "../instances/instanceBackupService.js";
import { appendInstanceRuntimeEvent } from "../instances/instanceRuntimeEventService.js";
import { getInstance } from "../instances/instanceService.js";
import { getAddonDetailForInstance, listAddonsForInstance } from "./addonService.js";
import { listInstanceAddonPacks, updateInstanceAddonEnablement, updateInstanceAddonSortOrders } from "./addonRepository.js";
import { getAddonDownloadBasePath } from "./addonStoragePaths.js";

type WorldPackReference = {
  pack_id: string;
  version: number[];
};

function assertChildPath(parentPath: string, childPath: string): void {
  const relativePath = relative(parentPath, childPath);
  if (relativePath === "" || relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new Error("Resolved addon path is outside the expected instance directory.");
  }
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

async function getActiveWorldPath(instance: Instance): Promise<string> {
  const worldsPath = join(instance.instancePath, "bds", "worlds");

  if (instance.activeWorldName) {
    const worldPath = join(worldsPath, instance.activeWorldName);
    assertChildPath(worldsPath, worldPath);
    return worldPath;
  }

  const worldDirectories: string[] = [];
  const directory = await opendir(worldsPath);
  for await (const entry of directory) {
    if (entry.isDirectory()) {
      worldDirectories.push(entry.name);
    }
  }

  if (worldDirectories.length === 1) {
    const [worldDirectory] = worldDirectories;
    if (worldDirectory) {
      return join(worldsPath, worldDirectory);
    }
  }

  if (worldDirectories.includes("Bedrock level")) {
    return join(worldsPath, "Bedrock level");
  }

  if (worldDirectories.length === 0) {
    throw new Error("Start the instance once to generate a world before enabling addons.");
  }

  throw new Error("Select an active world before enabling addons.");
}

async function readWorldPackReferences(path: string): Promise<WorldPackReference[]> {
  if (!(await pathExists(path))) {
    return [];
  }

  const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error(`World pack file is not an array: ${path}`);
  }

  return parsed.filter((entry): entry is WorldPackReference => {
    if (!entry || typeof entry !== "object") return false;
    const maybeReference = entry as Partial<WorldPackReference>;
    return typeof maybeReference.pack_id === "string" && Array.isArray(maybeReference.version);
  });
}

async function writeWorldPackReferences(path: string, references: WorldPackReference[]): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(references, null, 2)}\n`, "utf8");
}

function addWorldPackReference(references: WorldPackReference[], pack: InstanceAddonPack): WorldPackReference[] {
  const exists = references.some(
    (reference) => reference.pack_id === pack.headerUuid && JSON.stringify(reference.version) === JSON.stringify(pack.headerVersion),
  );

  if (exists) {
    return references;
  }

  return [...references, { pack_id: pack.headerUuid, version: pack.headerVersion }];
}

function removeWorldPackReference(references: WorldPackReference[], pack: InstanceAddonPack): WorldPackReference[] {
  return references.filter(
    (reference) => !(reference.pack_id === pack.headerUuid && JSON.stringify(reference.version) === JSON.stringify(pack.headerVersion)),
  );
}

function sameWorldPackReference(reference: WorldPackReference, pack: InstanceAddonPack): boolean {
  return reference.pack_id === pack.headerUuid && JSON.stringify(reference.version) === JSON.stringify(pack.headerVersion);
}

function applyManagedPackOrder(references: WorldPackReference[], orderedPacks: InstanceAddonPack[]): WorldPackReference[] {
  const unmanagedReferences = references.filter(
    (reference) => !orderedPacks.some((pack) => sameWorldPackReference(reference, pack)),
  );

  return [
    ...orderedPacks.map((pack) => ({
      pack_id: pack.headerUuid,
      version: pack.headerVersion,
    })),
    ...unmanagedReferences,
  ];
}

function getImportedPackPath(instance: Instance, pack: InstanceAddonPack): string {
  const version = pack.headerVersion.join("_");
  const folderName = `chroma_${pack.headerUuid}_${version}`;
  const packRoot = pack.packType === "behavior"
    ? join(instance.instancePath, "bds", "behavior_packs")
    : join(instance.instancePath, "bds", "resource_packs");
  const importedPath = join(packRoot, folderName);
  assertChildPath(packRoot, importedPath);
  return importedPath;
}

async function ensureCanChangeAddons(db: Database, instanceId: string): Promise<void> {
  const runtime = await getBdsRuntimeState(db, instanceId);
  if (runtime.isProcessActive || runtime.status === "running" || runtime.status === "starting" || runtime.status === "unknown") {
    throw new Error("Stop the instance before changing addons.");
  }
}

async function syncEnabledAddonPackOrder(db: Database, instance: Instance): Promise<void> {
  const enabledAddons = listAddonsForInstance(db, instance.id)
    .filter((addon) => addon.status === "enabled")
    .sort((left, right) => left.sortOrder - right.sortOrder || left.createdAt.localeCompare(right.createdAt));

  if (enabledAddons.length === 0) {
    return;
  }

  const orderedBehaviorPacks: InstanceAddonPack[] = [];
  const orderedResourcePacks: InstanceAddonPack[] = [];
  for (const addon of enabledAddons) {
    const packs = listInstanceAddonPacks(db, instance.id, addon.id)
      .filter((pack) => pack.status === "enabled")
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));

    for (const pack of packs) {
      if (pack.packType === "behavior") {
        orderedBehaviorPacks.push(pack);
      } else if (pack.packType === "resource") {
        orderedResourcePacks.push(pack);
      }
    }
  }

  const worldPath = await getActiveWorldPath(instance);
  const behaviorJsonPath = join(worldPath, "world_behavior_packs.json");
  const resourceJsonPath = join(worldPath, "world_resource_packs.json");
  const behaviorReferences = await readWorldPackReferences(behaviorJsonPath);
  const resourceReferences = await readWorldPackReferences(resourceJsonPath);

  await writeWorldPackReferences(behaviorJsonPath, applyManagedPackOrder(behaviorReferences, orderedBehaviorPacks));
  await writeWorldPackReferences(resourceJsonPath, applyManagedPackOrder(resourceReferences, orderedResourcePacks));
}

function getAddonAutoSortScore(addon: InstanceAddon): number {
  const searchText = `${addon.name} ${addon.summary ?? ""} ${addon.fileDisplayName ?? ""} ${addon.fileName ?? ""}`.toLowerCase();
  let score = 0;

  if (addon.packCounts.resource > 0) {
    score += 40;
  }
  if (addon.packCounts.behavior > 0) {
    score += 24;
  }
  if (addon.packCounts.resource > 0 && addon.packCounts.behavior === 0) {
    score += 8;
  }
  if (addon.packCounts.behavior > 0 && addon.packCounts.resource === 0) {
    score -= 4;
  }
  if (addon.packCounts.skin > 0 && addon.packCounts.behavior === 0 && addon.packCounts.resource === 0) {
    score -= 24;
  }

  if (/(patch|compat|compatibility|fix|hotfix|override|shader|texture|visual|graphics|ui|hud|sound|audio|lighting)/.test(searchText)) {
    score += 32;
  }
  if (/(core|library|framework|api|base|dependency|vanilla|foundation)/.test(searchText)) {
    score -= 22;
  }

  return score;
}

function buildAutoSortedAddonIds(addons: InstanceAddon[]): string[] {
  return [...addons]
    .sort((left, right) => {
      const scoreDifference = getAddonAutoSortScore(right) - getAddonAutoSortScore(left);
      if (scoreDifference !== 0) {
        return scoreDifference;
      }

      const resourceDifference = right.packCounts.resource - left.packCounts.resource;
      if (resourceDifference !== 0) {
        return resourceDifference;
      }

      const behaviorDifference = right.packCounts.behavior - left.packCounts.behavior;
      if (behaviorDifference !== 0) {
        return behaviorDifference;
      }

      const nameDifference = left.name.localeCompare(right.name);
      if (nameDifference !== 0) {
        return nameDifference;
      }

      return left.createdAt.localeCompare(right.createdAt);
    })
    .map((addon) => addon.id);
}

export async function enableAddonForInstance(db: Database, instanceId: string, addonId: string) {
  const instance = getInstance(db, instanceId);
  if (!instance) {
    throw new Error("Instance not found");
  }

  await ensureCanChangeAddons(db, instanceId);

  const detail = await getAddonDetailForInstance(db, instanceId, addonId);
  if (detail.addon.status === "error") {
    throw new Error("Addon cannot be enabled because it is in an error state.");
  }

  const supportedPacks = detail.packs.filter((pack) => pack.packType === "behavior" || pack.packType === "resource");
  if (supportedPacks.length === 0) {
    throw new Error("Addon has no supported packs to enable.");
  }

  const worldPath = await getActiveWorldPath(instance);
  const worldStats = await stat(worldPath);
  if (!worldStats.isDirectory()) {
    throw new Error("Active world path is not a directory.");
  }

  await createInternalRevertBackup(db, instanceId);

  const behaviorJsonPath = join(worldPath, "world_behavior_packs.json");
  const resourceJsonPath = join(worldPath, "world_resource_packs.json");
  let behaviorReferences = await readWorldPackReferences(behaviorJsonPath);
  let resourceReferences = await readWorldPackReferences(resourceJsonPath);
  const now = new Date().toISOString();
  const packUpdates: Parameters<typeof updateInstanceAddonEnablement>[3] = [];

  for (const pack of supportedPacks) {
    const importedPath = getImportedPackPath(instance, pack);
    if (await pathExists(importedPath)) {
      throw new Error(`Imported pack folder already exists: ${importedPath}`);
    }

    assertChildPath(getAddonDownloadBasePath(), pack.sourcePath);
    await copyDirectoryRecursive(pack.sourcePath, importedPath);

    if (pack.packType === "behavior") {
      behaviorReferences = addWorldPackReference(behaviorReferences, pack);
    } else {
      resourceReferences = addWorldPackReference(resourceReferences, pack);
    }

    packUpdates.push({
      packId: pack.id,
      status: "enabled",
      enabledPath: importedPath,
      enabledAt: now,
    });
  }

  await writeWorldPackReferences(behaviorJsonPath, behaviorReferences);
  await writeWorldPackReferences(resourceJsonPath, resourceReferences);
  updateInstanceAddonEnablement(db, addonId, "enabled", packUpdates, now);
  await syncEnabledAddonPackOrder(db, instance);

  await appendInstanceRuntimeEvent(db, instanceId, {
    category: "settings",
    action: "addon_enabled",
    level: "info",
    message: `Enabled addon ${detail.addon.name}.`,
    details: {
      addonId,
      packCount: supportedPacks.length,
    },
  });

  return await getAddonDetailForInstance(db, instanceId, addonId);
}

export async function disableAddonForInstance(db: Database, instanceId: string, addonId: string) {
  const instance = getInstance(db, instanceId);
  if (!instance) {
    throw new Error("Instance not found");
  }

  await ensureCanChangeAddons(db, instanceId);

  const detail = await getAddonDetailForInstance(db, instanceId, addonId);
  const enabledPacks = detail.packs.filter((pack) => pack.status === "enabled");
  if (enabledPacks.length === 0) {
    throw new Error("Addon has no enabled packs.");
  }

  const worldPath = await getActiveWorldPath(instance);
  await createInternalRevertBackup(db, instanceId);

  const behaviorJsonPath = join(worldPath, "world_behavior_packs.json");
  const resourceJsonPath = join(worldPath, "world_resource_packs.json");
  let behaviorReferences = await readWorldPackReferences(behaviorJsonPath);
  let resourceReferences = await readWorldPackReferences(resourceJsonPath);
  const now = new Date().toISOString();
  const packUpdates: Parameters<typeof updateInstanceAddonEnablement>[3] = [];

  for (const pack of enabledPacks) {
    if (pack.packType === "behavior") {
      behaviorReferences = removeWorldPackReference(behaviorReferences, pack);
    } else if (pack.packType === "resource") {
      resourceReferences = removeWorldPackReference(resourceReferences, pack);
    }

    if (pack.enabledPath) {
      const expectedRoot = pack.packType === "behavior"
        ? join(instance.instancePath, "bds", "behavior_packs")
        : join(instance.instancePath, "bds", "resource_packs");
      assertChildPath(expectedRoot, pack.enabledPath);
      await rm(pack.enabledPath, { recursive: true, force: true });
    }

    packUpdates.push({
      packId: pack.id,
      status: "disabled",
      disabledAt: now,
    });
  }

  await writeWorldPackReferences(behaviorJsonPath, behaviorReferences);
  await writeWorldPackReferences(resourceJsonPath, resourceReferences);
  updateInstanceAddonEnablement(db, addonId, "disabled", packUpdates, now);

  await appendInstanceRuntimeEvent(db, instanceId, {
    category: "settings",
    action: "addon_disabled",
    level: "info",
    message: `Disabled addon ${detail.addon.name}.`,
    details: {
      addonId,
      packCount: enabledPacks.length,
    },
  });

  return await getAddonDetailForInstance(db, instanceId, addonId);
}

export async function reorderAddonsForInstance(
  db: Database,
  instanceId: string,
  addonIdsInOrder: string[],
): Promise<{ addons: InstanceAddon[] }> {
  const instance = getInstance(db, instanceId);
  if (!instance) {
    throw new Error("Instance not found");
  }

  await ensureCanChangeAddons(db, instanceId);

  const currentAddons = listAddonsForInstance(db, instanceId);
  const currentAddonIds = new Set(currentAddons.map((addon) => addon.id));
  if (
    addonIdsInOrder.length !== currentAddons.length ||
    addonIdsInOrder.some((addonId) => !currentAddonIds.has(addonId)) ||
    new Set(addonIdsInOrder).size !== addonIdsInOrder.length
  ) {
    throw new Error("addonIds must contain every linked addon exactly once");
  }

  const updatedAt = new Date().toISOString();
  updateInstanceAddonSortOrders(db, instanceId, addonIdsInOrder, updatedAt);
  await syncEnabledAddonPackOrder(db, instance);

  await appendInstanceRuntimeEvent(db, instanceId, {
    category: "settings",
    action: "addon_order_updated",
    level: "info",
    message: "Updated addon order.",
    details: {
      addonCount: addonIdsInOrder.length,
    },
  });

  return {
    addons: listAddonsForInstance(db, instanceId),
  };
}

export async function autoSortAddonsForInstance(db: Database, instanceId: string): Promise<{ addons: InstanceAddon[] }> {
  const addons = listAddonsForInstance(db, instanceId);
  const orderedAddonIds = buildAutoSortedAddonIds(addons);
  return reorderAddonsForInstance(db, instanceId, orderedAddonIds);
}
