import type { Database } from "better-sqlite3";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import type { AddonLibraryItem, AddonLibraryLinkedInstance, CurseForgeAddonSearchResult, InstanceAddon, InstanceAddonPack } from "../../shared/types/index.js";
import { createId } from "../utils/createId.js";
import { getRuntimePaths } from "../config/paths.js";
import { getInstance, listInstances } from "../instances/instanceService.js";
import { getCurseForgeApiKey } from "../setup/setupService.js";
import { appendInstanceRuntimeEvent } from "../instances/instanceRuntimeEventService.js";
import {
  deleteAddonFileById,
  deleteInstanceAddonById,
  getInstanceAddon,
  getInstanceAddonByProviderFile,
  getInstanceAddonByProviderProject,
  getAddonFile,
  getAddonFileByProviderFile,
  getNextInstanceAddonSortOrder,
  listAddonFiles,
  listAddonFilePacks,
  listAddonLibraryLinkedInstances,
  listInstanceAddonPacks,
  listInstanceAddons,
  markAddonFileRecovered,
  saveAddonFilePacks,
  saveAddonFileWithPacks,
  saveInstanceAddonWithPacks,
  updateInstanceAddonAutoUpdate,
  type SaveAddonFileInput,
  type SaveAddonFilePackInput,
  type SaveInstanceAddonInput,
  type SaveInstanceAddonPackInput,
} from "./addonRepository.js";
import { inspectAddonArchive } from "./addonArchiveService.js";
import type { DiscoveredAddonPack } from "./addonArchiveService.js";
import { CurseForgeClient, type CurseForgeMod } from "./curseForgeClient.js";
import { getCurseForgeAddonStoragePaths } from "./addonStoragePaths.js";

function getTotalPackCount(addonFile: AddonLibraryItem): number {
  return addonFile.packCounts.behavior + addonFile.packCounts.resource + addonFile.packCounts.skin + addonFile.packCounts.unknown;
}

function mapDiscoveredAddonFilePack(addonFileId: string, pack: DiscoveredAddonPack, now: string): SaveAddonFilePackInput {
  const savedPack: SaveAddonFilePackInput = {
    id: createId("afpack"),
    addonFileId,
    packType: pack.packType,
    headerUuid: pack.headerUuid,
    headerVersionJson: JSON.stringify(pack.headerVersion),
    sourcePath: pack.sourcePath,
    manifestJson: pack.manifestJson,
    createdAt: now,
    updatedAt: now,
  };

  if (pack.name) savedPack.name = pack.name;
  if (pack.description) savedPack.description = pack.description;
  if (pack.minEngineVersion) savedPack.minEngineVersionJson = JSON.stringify(pack.minEngineVersion);

  return savedPack;
}

async function repairAddonLibraryFileIfNeeded(db: Database, addonFileId: string): Promise<AddonLibraryItem> {
  const addonFile = getAddonFile(db, addonFileId);
  if (!addonFile) {
    throw new Error("Addon not found");
  }

  if (getTotalPackCount(addonFile) > 0) {
    if (addonFile.error) {
      const now = new Date().toISOString();
      markAddonFileRecovered(db, addonFile.id, now);
      return getAddonFile(db, addonFileId) ?? addonFile;
    }

    return addonFile;
  }

  if (!addonFile.archivePath || !addonFile.extractedPath) {
    return addonFile;
  }

  const discoveredPacks = await inspectAddonArchive(addonFile.archivePath, addonFile.extractedPath);
  if (discoveredPacks.length === 0) {
    return addonFile;
  }

  const now = new Date().toISOString();
  const packs = discoveredPacks.map((pack) => mapDiscoveredAddonFilePack(addonFile.id, pack, now));
  saveAddonFilePacks(db, addonFile.id, packs);
  markAddonFileRecovered(db, addonFile.id, now);

  return getAddonFile(db, addonFileId) ?? addonFile;
}

export async function listAddonLibrary(db: Database): Promise<AddonLibraryItem[]> {
  const addons = listAddonFiles(db);
  const repairedAddons: AddonLibraryItem[] = [];

  for (const addon of addons) {
    if (getTotalPackCount(addon) === 0 && addon.archivePath && addon.extractedPath) {
      repairedAddons.push(await repairAddonLibraryFileIfNeeded(db, addon.id));
    } else {
      repairedAddons.push(addon);
    }
  }

  return repairedAddons;
}

function buildInstanceAddonFromLibraryFile(
  addonFile: AddonLibraryItem,
  instanceId: string,
  now: string,
  autoUpdateEnabled: boolean,
  sortOrder: number,
  addonId = createId("addon"),
): SaveInstanceAddonInput {
  const addon: SaveInstanceAddonInput = {
    id: addonId,
    instanceId,
    addonFileId: addonFile.id,
    sortOrder,
    autoUpdateEnabled,
    provider: addonFile.provider,
    providerProjectId: addonFile.providerProjectId,
    providerFileId: addonFile.providerFileId,
    name: addonFile.name,
    status: addonFile.error ? "error" : "downloaded",
    workspacePath: addonFile.workspacePath,
    createdAt: now,
    updatedAt: now,
  };

  if (addonFile.error) addon.error = addonFile.error;
  if (addonFile.archivePath) addon.archivePath = addonFile.archivePath;
  if (addonFile.extractedPath) addon.extractedPath = addonFile.extractedPath;
  if (addonFile.slug) addon.slug = addonFile.slug;
  if (addonFile.summary) addon.summary = addonFile.summary;
  if (addonFile.websiteUrl) addon.websiteUrl = addonFile.websiteUrl;
  if (addonFile.logoUrl) addon.logoUrl = addonFile.logoUrl;
  if (addonFile.fileName) addon.fileName = addonFile.fileName;
  if (addonFile.fileDisplayName) addon.fileDisplayName = addonFile.fileDisplayName;
  if (addonFile.fileDate) addon.fileDate = addonFile.fileDate;
  if (typeof addonFile.downloadCount === "number") addon.downloadCount = addonFile.downloadCount;

  return addon;
}

async function buildInstanceAddonPacksFromLibraryFile(
  db: Database,
  addonFileId: string,
  instanceId: string,
  addonId: string,
  now: string,
): Promise<SaveInstanceAddonPackInput[]> {
  await repairAddonLibraryFileIfNeeded(db, addonFileId);
  return listAddonFilePacks(db, addonFileId).map((pack) => ({
    id: createId("pack"),
    instanceId,
    addonId,
    addonFilePackId: pack.id,
    packType: pack.packType,
    headerUuid: pack.headerUuid,
    headerVersionJson: pack.headerVersionJson,
    sourcePath: pack.sourcePath,
    status: "downloaded",
    createdAt: now,
    updatedAt: now,
    ...(pack.name ? { name: pack.name } : {}),
    ...(pack.description ? { description: pack.description } : {}),
    ...(pack.minEngineVersionJson ? { minEngineVersionJson: pack.minEngineVersionJson } : {}),
    ...(pack.manifestJson ? { manifestJson: pack.manifestJson } : {}),
  }));
}

function assertManagedAddonPath(path: string): void {
  const runtimePaths = getRuntimePaths();
  const targetPath = resolve(path);
  const addonRoot = resolve(runtimePaths.dataDir, "downloads/addons");
  const instanceRoot = resolve(runtimePaths.dataDir, "instances");
  const relativeToAddonRoot = relative(addonRoot, targetPath);
  const relativeToInstanceRoot = relative(instanceRoot, targetPath);
  const isCentralAddonPath =
    relativeToAddonRoot !== "" && !relativeToAddonRoot.startsWith("..") && !relativeToAddonRoot.startsWith(sep);
  const isLegacyInstanceAddonPath =
    relativeToInstanceRoot !== "" &&
    !relativeToInstanceRoot.startsWith("..") &&
    !relativeToInstanceRoot.startsWith(sep) &&
    relativeToInstanceRoot.split(sep).includes("csm") &&
    relativeToInstanceRoot.split(sep).includes("addons");

  if (!isCentralAddonPath && !isLegacyInstanceAddonPath) {
    throw new Error("Addon path is outside the managed addon library directory.");
  }
}

export async function deleteAddonFromLibrary(db: Database, addonFileId: string): Promise<void> {
  const addon = getAddonFile(db, addonFileId);
  if (!addon) {
    throw new Error("Addon not found");
  }

  if (addon.registeredInstanceCount > 0) {
    throw new Error("Remove this addon from all instances before deleting it from the library.");
  }

  deleteAddonFileById(db, addonFileId);
  assertManagedAddonPath(addon.workspacePath);
  await rm(resolve(addon.workspacePath), { recursive: true, force: true });
}

export function listAddonsForInstance(db: Database, instanceId: string): InstanceAddon[] {
  const instance = getInstance(db, instanceId);
  if (!instance) {
    throw new Error("Instance not found");
  }

  return listInstanceAddons(db, instanceId);
}

export async function getAddonDetailForInstance(
  db: Database,
  instanceId: string,
  addonId: string,
): Promise<{ addon: InstanceAddon; packs: InstanceAddonPack[] }> {
  const instance = getInstance(db, instanceId);
  if (!instance) {
    throw new Error("Instance not found");
  }

  const addon = getInstanceAddon(db, instanceId, addonId);
  if (!addon) {
    throw new Error("Addon not found");
  }

  await repairAddonLibraryFileIfNeeded(db, addon.addonFileId);

  return {
    addon,
    packs: listInstanceAddonPacks(db, instanceId, addonId),
  };
}

export async function getAddonLibraryEditor(
  db: Database,
  addonFileId: string,
): Promise<{ addon: AddonLibraryItem; instances: AddonLibraryLinkedInstance[] }> {
  const addon = await repairAddonLibraryFileIfNeeded(db, addonFileId);

  return {
    addon,
    instances: listAddonLibraryLinkedInstances(db, addonFileId),
  };
}

export async function updateAddonLibraryLinks(
  db: Database,
  addonFileId: string,
  links: Array<{ instanceId: string; autoUpdateEnabled: boolean }>,
): Promise<{ addon: AddonLibraryItem; instances: AddonLibraryLinkedInstance[] }> {
  const addonFile = await repairAddonLibraryFileIfNeeded(db, addonFileId);

  const uniqueLinks = new Map<string, boolean>();
  for (const link of links) {
    uniqueLinks.set(link.instanceId, link.autoUpdateEnabled);
  }

  const instances = listInstances(db);
  const instanceById = new Map(instances.map((instance) => [instance.id, instance]));
  const existingExactLinks = listAddonLibraryLinkedInstances(db, addonFileId).filter((instance) => instance.linked);
  const now = new Date().toISOString();

  for (const instanceId of uniqueLinks.keys()) {
    if (!instanceById.has(instanceId)) {
      throw new Error("Instance not found");
    }
  }

  for (const linkedInstance of existingExactLinks) {
    if (uniqueLinks.has(linkedInstance.instanceId)) {
      continue;
    }

    const existingAddon = getInstanceAddonByProviderFile(
      db,
      linkedInstance.instanceId,
      addonFile.provider,
      addonFile.providerProjectId,
      addonFile.providerFileId,
    );
    if (!existingAddon) {
      continue;
    }

    if (existingAddon.status === "enabled") {
      const instance = instanceById.get(linkedInstance.instanceId);
      throw new Error(`Disable ${existingAddon.name} for ${instance?.friendlyName ?? "this instance"} before unlinking it.`);
    }

    deleteInstanceAddonById(db, linkedInstance.instanceId, existingAddon.id);
  }

  for (const [instanceId, autoUpdateEnabled] of uniqueLinks.entries()) {
    const existingExactAddon = getInstanceAddonByProviderFile(
      db,
      instanceId,
      addonFile.provider,
      addonFile.providerProjectId,
      addonFile.providerFileId,
    );

    if (existingExactAddon) {
      if (existingExactAddon.autoUpdateEnabled !== autoUpdateEnabled) {
        updateInstanceAddonAutoUpdate(db, existingExactAddon.id, autoUpdateEnabled);
      }
      continue;
    }

    const existingProjectAddon = getInstanceAddonByProviderProject(
      db,
      instanceId,
      addonFile.provider,
      addonFile.providerProjectId,
    );
    if (existingProjectAddon) {
      if (existingProjectAddon.status === "enabled") {
        const instance = instanceById.get(instanceId);
        throw new Error(`Disable ${existingProjectAddon.name} for ${instance?.friendlyName ?? "this instance"} before switching versions.`);
      }

      deleteInstanceAddonById(db, instanceId, existingProjectAddon.id);
    }

    const addonId = createId("addon");
    const sortOrder = getNextInstanceAddonSortOrder(db, instanceId);
    const addon = buildInstanceAddonFromLibraryFile(addonFile, instanceId, now, autoUpdateEnabled, sortOrder, addonId);
    const packs = await buildInstanceAddonPacksFromLibraryFile(db, addonFile.id, instanceId, addonId, now);

    saveInstanceAddonWithPacks(db, addon, packs);
  }

  return await getAddonLibraryEditor(db, addonFileId);
}

export async function selectLibraryAddonsForInstance(
  db: Database,
  instanceId: string,
  addonFileIds: string[],
): Promise<{ addons: InstanceAddon[] }> {
  const instance = getInstance(db, instanceId);
  if (!instance) {
    throw new Error("Instance not found");
  }

  const uniqueAddonFileIds = [...new Set(addonFileIds)];
  const selectedProjectKeys = new Set<string>();
  const now = new Date().toISOString();
  const currentAddons = listInstanceAddons(db, instanceId);

  for (const currentAddon of currentAddons) {
    if (uniqueAddonFileIds.includes(currentAddon.addonFileId)) {
      continue;
    }

    if (currentAddon.status === "enabled") {
      throw new Error(`Disable ${currentAddon.name} before removing it from this instance.`);
    }

    deleteInstanceAddonById(db, instanceId, currentAddon.id);
  }

  for (const addonFileId of uniqueAddonFileIds) {
    const addonFile = getAddonFile(db, addonFileId);
    if (!addonFile) {
      throw new Error("Addon not found");
    }

    const projectKey = `${addonFile.provider}:${addonFile.providerProjectId}`;
    if (selectedProjectKeys.has(projectKey)) {
      throw new Error(`Select only one downloaded version of ${addonFile.name} for this instance.`);
    }
    selectedProjectKeys.add(projectKey);

    const existingAddon = getInstanceAddonByProviderFile(
      db,
      instanceId,
      addonFile.provider,
      addonFile.providerProjectId,
      addonFile.providerFileId,
    );
    if (existingAddon?.status === "enabled") {
      continue;
    }

    const addonId = existingAddon?.id ?? createId("addon");
    const sortOrder = existingAddon?.sortOrder ?? getNextInstanceAddonSortOrder(db, instanceId);
    const addon = buildInstanceAddonFromLibraryFile(addonFile, instanceId, now, true, sortOrder, addonId);
    const packs = await buildInstanceAddonPacksFromLibraryFile(db, addonFile.id, instanceId, addonId, now);

    saveInstanceAddonWithPacks(db, addon, packs);
  }

  return {
    addons: listInstanceAddons(db, instanceId),
  };
}

export type DownloadCurseForgeAddonInput = {
  projectId: number;
  fileId: number;
};

async function fetchCurseForgeAddonFile(db: Database, input: DownloadCurseForgeAddonInput) {
  const apiKey = getCurseForgeApiKey(db);
  if (!apiKey) {
    throw new Error("CurseForge API key is not configured");
  }

  const client = new CurseForgeClient(apiKey);
  const [mod, file] = await Promise.all([
    client.getMod(input.projectId),
    client.getModFile(input.projectId, input.fileId),
  ]);

  const paths = getCurseForgeAddonStoragePaths(input.projectId, input.fileId, file.fileName);
  if (!existsSync(paths.archivePath)) {
    const downloadUrl = await client.getModFileDownloadUrl(input.projectId, input.fileId);
    if (!downloadUrl) {
      throw new Error("CurseForge did not provide a download URL for this file.");
    }

    await mkdir(paths.archiveDirectory, { recursive: true });
    await downloadFile(downloadUrl, paths.archivePath);
  }

  let error: string | undefined;
  let discoveredPacks: DiscoveredAddonPack[] = [];

  try {
    discoveredPacks = await inspectAddonArchive(paths.archivePath, paths.extractedPath);
    if (discoveredPacks.length === 0) {
      error = "No Bedrock pack manifests were discovered in the downloaded archive.";
    }
  } catch (inspectionError) {
    error = inspectionError instanceof Error ? inspectionError.message : String(inspectionError);
  }

  return {
    mod,
    file,
    paths,
    error,
    discoveredPacks,
  };
}

async function downloadFile(downloadUrl: string, archivePath: string): Promise<void> {
  const response = await fetch(downloadUrl);
  if (!response.ok) {
    throw new Error(`CurseForge file download failed with status ${response.status}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  await writeFile(archivePath, buffer, { flag: "wx" });
}

function mapModToSearchResult(mod: CurseForgeMod, fileId: number): CurseForgeAddonSearchResult {
  const latestFile = mod.latestFiles?.find((file) => file.id === fileId) ?? mod.latestFiles?.find((file) => file.id === mod.mainFileId);
  const result: CurseForgeAddonSearchResult = {
    projectId: mod.id,
    name: mod.name,
    slug: mod.slug,
    summary: mod.summary,
    authors: mod.authors?.map((author) => ({
      id: author.id,
      name: author.name,
      ...(author.url ? { url: author.url } : {}),
    })) ?? [],
    downloadCount: mod.downloadCount,
    latestGameVersions: latestFile?.gameVersions ?? [],
  };

  if (mod.links?.websiteUrl) result.websiteUrl = mod.links.websiteUrl;
  const logoUrl = mod.logo?.thumbnailUrl ?? mod.logo?.url;
  if (logoUrl) result.logoUrl = logoUrl;
  if (latestFile) {
    result.latestFileId = latestFile.id;
    result.latestFileName = latestFile.fileName;
    result.latestFileDisplayName = latestFile.displayName;
    result.latestFileDate = latestFile.fileDate;
  }
  if (typeof mod.rating === "number") result.rating = mod.rating;

  return result;
}

export async function downloadCurseForgeAddonForInstance(
  db: Database,
  instanceId: string,
  input: DownloadCurseForgeAddonInput,
): Promise<{ addon: InstanceAddon; packs: InstanceAddonPack[] }> {
  const instance = getInstance(db, instanceId);
  if (!instance) {
    throw new Error("Instance not found");
  }

  const existingAddon = getInstanceAddonByProviderFile(db, instanceId, "curseforge", String(input.projectId), String(input.fileId));
  if (existingAddon) {
    return await getAddonDetailForInstance(db, instanceId, existingAddon.id);
  }

  const { mod, file, paths, error, discoveredPacks } = await fetchCurseForgeAddonFile(db, input);
  const now = new Date().toISOString();
  const addonId = createId("addon");
  const addonFileId = createId("afile");
  let status: SaveInstanceAddonInput["status"] = "downloaded";
  if (error) {
    status = "error";
  }

  const searchResult = mapModToSearchResult(mod, input.fileId);
  const addon: SaveInstanceAddonInput = {
    id: addonId,
    instanceId,
    addonFileId,
    sortOrder: getNextInstanceAddonSortOrder(db, instanceId),
    autoUpdateEnabled: true,
    provider: "curseforge",
    providerProjectId: String(input.projectId),
    providerFileId: String(input.fileId),
    name: mod.name,
    status,
    workspacePath: paths.workspacePath,
    archivePath: paths.archivePath,
    extractedPath: paths.extractedPath,
    providerMetadataJson: JSON.stringify({ project: searchResult, file }),
    ...(error ? { error } : {}),
    createdAt: now,
    updatedAt: now,
  };

  if (mod.slug) addon.slug = mod.slug;
  if (mod.summary) addon.summary = mod.summary;
  if (mod.links?.websiteUrl) addon.websiteUrl = mod.links.websiteUrl;
  const logoUrl = mod.logo?.thumbnailUrl ?? mod.logo?.url;
  if (logoUrl) addon.logoUrl = logoUrl;
  if (file.fileName) addon.fileName = file.fileName;
  if (file.displayName) addon.fileDisplayName = file.displayName;
  if (file.fileDate) addon.fileDate = file.fileDate;
  addon.downloadCount = file.downloadCount ?? mod.downloadCount;

  const packs: SaveInstanceAddonPackInput[] = discoveredPacks.map((pack) => {
    const savedPack: SaveInstanceAddonPackInput = {
      id: createId("pack"),
      instanceId,
      addonId,
      addonFilePackId: createId("afpack"),
      packType: pack.packType,
      headerUuid: pack.headerUuid,
      headerVersionJson: JSON.stringify(pack.headerVersion),
      sourcePath: pack.sourcePath,
      status: pack.status,
      manifestJson: pack.manifestJson,
      createdAt: now,
      updatedAt: now,
    };

    if (pack.name) savedPack.name = pack.name;
    if (pack.description) savedPack.description = pack.description;
    if (pack.minEngineVersion) savedPack.minEngineVersionJson = JSON.stringify(pack.minEngineVersion);

    return savedPack;
  });

  saveInstanceAddonWithPacks(db, addon, packs);

  await appendInstanceRuntimeEvent(db, instanceId, {
    category: "settings",
    action: "addon_downloaded",
    level: status === "error" ? "warning" : "info",
    message: status === "error" ? `Downloaded ${mod.name}, but pack inspection failed.` : `Downloaded addon ${mod.name}.`,
    details: {
      provider: "curseforge",
      projectId: input.projectId,
      fileId: input.fileId,
      packCount: packs.length,
    },
  });

  return await getAddonDetailForInstance(db, instanceId, addonId);
}

export async function downloadCurseForgeAddonToLibrary(
  db: Database,
  input: DownloadCurseForgeAddonInput,
): Promise<{ addon: AddonLibraryItem }> {
  const existingAddon = getAddonFileByProviderFile(db, "curseforge", String(input.projectId), String(input.fileId));
  if (existingAddon && !existingAddon.error) {
    return { addon: existingAddon };
  }

  const { mod, file, paths, error, discoveredPacks } = await fetchCurseForgeAddonFile(db, input);
  const now = new Date().toISOString();
  const searchResult = mapModToSearchResult(mod, input.fileId);
  const addon: SaveAddonFileInput = {
    id: existingAddon?.id ?? createId("afile"),
    provider: "curseforge",
    providerProjectId: String(input.projectId),
    providerFileId: String(input.fileId),
    name: mod.name,
    workspacePath: paths.workspacePath,
    archivePath: paths.archivePath,
    extractedPath: paths.extractedPath,
    providerMetadataJson: JSON.stringify({ project: searchResult, file }),
    ...(error ? { error } : {}),
    createdAt: now,
    updatedAt: now,
  };

  if (mod.slug) addon.slug = mod.slug;
  if (mod.summary) addon.summary = mod.summary;
  if (mod.links?.websiteUrl) addon.websiteUrl = mod.links.websiteUrl;
  const logoUrl = mod.logo?.thumbnailUrl ?? mod.logo?.url;
  if (logoUrl) addon.logoUrl = logoUrl;
  if (file.fileName) addon.fileName = file.fileName;
  if (file.displayName) addon.fileDisplayName = file.displayName;
  if (file.fileDate) addon.fileDate = file.fileDate;
  addon.downloadCount = file.downloadCount ?? mod.downloadCount;

  const packs: SaveAddonFilePackInput[] = discoveredPacks.map((pack) => mapDiscoveredAddonFilePack(addon.id, pack, now));

  saveAddonFileWithPacks(db, addon, packs);

  const savedAddon = getAddonFileByProviderFile(db, "curseforge", String(input.projectId), String(input.fileId));
  if (!savedAddon) {
    throw new Error("Downloaded addon was not saved in the library.");
  }

  return { addon: savedAddon };
}
