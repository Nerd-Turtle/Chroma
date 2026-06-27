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
  listAddonFileDownloads,
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
  type SaveAddonFileDownloadInput,
  type SaveAddonFilePackInput,
  type SaveInstanceAddonInput,
  type SaveInstanceAddonPackInput,
} from "./addonRepository.js";
import { inspectAddonArchive } from "./addonArchiveService.js";
import type { DiscoveredAddonPack } from "./addonArchiveService.js";
import { CurseForgeClient, type CurseForgeMod, type CurseForgeModFile } from "./curseForgeClient.js";
import { getCurseForgeAddonReleaseFileStoragePaths, getCurseForgeAddonReleaseStoragePaths } from "./addonStoragePaths.js";

function getTotalPackCount(addonFile: AddonLibraryItem): number {
  return addonFile.packCounts.behavior + addonFile.packCounts.resource + addonFile.packCounts.skin + addonFile.packCounts.unknown;
}

function mapDiscoveredAddonFilePack(
  addonFileId: string,
  pack: DiscoveredAddonPack,
  now: string,
  addonFileDownloadId?: string,
): SaveAddonFilePackInput {
  const savedPack: SaveAddonFilePackInput = {
    id: createId("afpack"),
    addonFileId,
    ...(addonFileDownloadId ? { addonFileDownloadId } : {}),
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
    if (addonFile.error && addonFile.downloadedFileCount === 0) {
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
    ...(pack.addonFileDownloadId ? { addonFileDownloadId: pack.addonFileDownloadId } : {}),
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
): Promise<{ addon: InstanceAddon; downloadedFiles: ReturnType<typeof listAddonFileDownloads>; packs: InstanceAddonPack[] }> {
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
    downloadedFiles: listAddonFileDownloads(db, addon.addonFileId),
    packs: listInstanceAddonPacks(db, instanceId, addonId),
  };
}

export async function getAddonLibraryEditor(
  db: Database,
  addonFileId: string,
): Promise<{ addon: AddonLibraryItem; downloadedFiles: ReturnType<typeof listAddonFileDownloads>; instances: AddonLibraryLinkedInstance[] }> {
  const addon = await repairAddonLibraryFileIfNeeded(db, addonFileId);

  return {
    addon,
    downloadedFiles: listAddonFileDownloads(db, addonFileId),
    instances: listAddonLibraryLinkedInstances(db, addonFileId),
  };
}

export async function updateAddonLibraryLinks(
  db: Database,
  addonFileId: string,
  links: Array<{ instanceId: string; autoUpdateEnabled: boolean }>,
): Promise<{ addon: AddonLibraryItem; downloadedFiles: ReturnType<typeof listAddonFileDownloads>; instances: AddonLibraryLinkedInstance[] }> {
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
  fileId?: number;
};

type InspectedCurseForgeAddonPack = {
  pack: DiscoveredAddonPack;
  addonFileDownloadId: string;
};

type DownloadedCurseForgeAddonFile = {
  file: CurseForgeModFile;
  download: SaveAddonFileDownloadInput;
};

function hasNormalizedCurseForgeFiles(addon: AddonLibraryItem | InstanceAddon | undefined): boolean {
  return Boolean(addon && !addon.error && addon.downloadedFileCount > 0);
}

function isBedrockAddonArchive(file: CurseForgeModFile): boolean {
  const fileName = file.fileName.toLowerCase();
  return fileName.endsWith(".mcpack") || fileName.endsWith(".mcaddon") || fileName.endsWith(".zip");
}

function getFileDay(file: CurseForgeModFile): string {
  return file.fileDate.slice(0, 10);
}

function getFileVersionTokens(file: CurseForgeModFile): string[] {
  const source = `${file.displayName} ${file.fileName}`.toLowerCase();
  const matches = source.match(/v?\d+(?:\.\d+){1,3}/g) ?? [];
  return [...new Set(matches.map((match) => match.replace(/^v/, "")))];
}

function hasSharedGameVersion(left: CurseForgeModFile, right: CurseForgeModFile): boolean {
  const leftVersions = new Set(left.gameVersions ?? []);
  return (right.gameVersions ?? []).some((version) => leftVersions.has(version));
}

function compareCurseForgeFileDateDesc(left: CurseForgeModFile, right: CurseForgeModFile): number {
  const dateDifference = Date.parse(right.fileDate) - Date.parse(left.fileDate);
  return dateDifference !== 0 ? dateDifference : right.id - left.id;
}

function selectCurseForgeReleaseFiles(
  mod: CurseForgeMod,
  files: CurseForgeModFile[],
  requestedFileId: number | undefined,
): { releaseFileId: number; files: CurseForgeModFile[] } {
  const installableFiles = files
    .filter((file) => file.isAvailable !== false)
    .filter(isBedrockAddonArchive)
    .sort(compareCurseForgeFileDateDesc);

  if (installableFiles.length === 0) {
    throw new Error("CurseForge did not return any Bedrock addon files for this project.");
  }

  const anchor =
    (requestedFileId ? installableFiles.find((file) => file.id === requestedFileId) : undefined) ??
    (mod.mainFileId ? installableFiles.find((file) => file.id === mod.mainFileId) : undefined) ??
    installableFiles[0];
  if (!anchor) {
    throw new Error("CurseForge did not return a selectable addon file.");
  }

  const anchorDay = getFileDay(anchor);
  const anchorVersionTokens = new Set(getFileVersionTokens(anchor));
  const releaseFiles = installableFiles.filter((file) => {
    if (file.id === anchor.id) return true;
    if (getFileDay(file) !== anchorDay) return false;

    const fileVersionTokens = getFileVersionTokens(file);
    if (anchorVersionTokens.size > 0) {
      return fileVersionTokens.some((token) => anchorVersionTokens.has(token));
    }

    return hasSharedGameVersion(anchor, file);
  });

  return {
    releaseFileId: anchor.id,
    files: releaseFiles.sort((left, right) => left.fileName.localeCompare(right.fileName)),
  };
}

function buildMissingDependencyMessage(packs: InspectedCurseForgeAddonPack[]): string | undefined {
  const discoveredPackUuids = new Set(packs.map(({ pack }) => pack.headerUuid.toLowerCase()));
  const missingDependencyUuids = new Set<string>();
  for (const { pack } of packs) {
    for (const dependencyUuid of pack.dependencyUuids) {
      if (!discoveredPackUuids.has(dependencyUuid.toLowerCase())) {
        missingDependencyUuids.add(dependencyUuid);
      }
    }
  }

  if (missingDependencyUuids.size === 0) {
    return undefined;
  }

  return `Missing required pack dependencies: ${[...missingDependencyUuids].join(", ")}`;
}

function getDiscoveredPackIdentity(pack: DiscoveredAddonPack): string {
  return `${pack.packType}:${pack.headerUuid.toLowerCase()}:${JSON.stringify(pack.headerVersion)}`;
}

function dedupeDiscoveredPacks(packs: InspectedCurseForgeAddonPack[]): InspectedCurseForgeAddonPack[] {
  const packsByIdentity = new Map<string, InspectedCurseForgeAddonPack>();
  for (const inspectedPack of packs) {
    const identity = getDiscoveredPackIdentity(inspectedPack.pack);
    if (!packsByIdentity.has(identity)) {
      packsByIdentity.set(identity, inspectedPack);
    }
  }

  return [...packsByIdentity.values()];
}

async function fetchCurseForgeAddonProject(db: Database, input: DownloadCurseForgeAddonInput) {
  const apiKey = getCurseForgeApiKey(db);
  if (!apiKey) {
    throw new Error("CurseForge API key is not configured");
  }

  const client = new CurseForgeClient(apiKey);
  const [mod, projectFiles] = await Promise.all([
    client.getMod(input.projectId),
    client.getModFiles(input.projectId),
  ]);
  const selectedRelease = selectCurseForgeReleaseFiles(mod, projectFiles, input.fileId);
  const releasePaths = getCurseForgeAddonReleaseStoragePaths(input.projectId, selectedRelease.releaseFileId);
  const downloadedFiles: DownloadedCurseForgeAddonFile[] = [];
  const discoveredPacks: InspectedCurseForgeAddonPack[] = [];
  const fileErrors: string[] = [];
  const now = new Date().toISOString();

  for (const file of selectedRelease.files) {
    const paths = getCurseForgeAddonReleaseFileStoragePaths(input.projectId, selectedRelease.releaseFileId, file.id, file.fileName);
    const downloadId = createId("afd");
    let status: SaveAddonFileDownloadInput["status"] = "downloaded";
    let error: string | undefined;
    let filePacks: DiscoveredAddonPack[] = [];

    try {
      if (!existsSync(paths.archivePath)) {
        const downloadUrl = await client.getModFileDownloadUrl(input.projectId, file.id);
        if (!downloadUrl) {
          throw new Error("CurseForge did not provide a download URL for this file.");
        }

        await mkdir(paths.archiveDirectory, { recursive: true });
        await downloadFile(downloadUrl, paths.archivePath);
      }

      filePacks = await inspectAddonArchive(paths.archivePath, paths.extractedPath);
      if (filePacks.length === 0) {
        throw new Error("No Bedrock pack manifests were discovered in this CurseForge file.");
      }
    } catch (fileError) {
      status = "error";
      error = fileError instanceof Error ? fileError.message : String(fileError);
      fileErrors.push(`${file.fileName}: ${error}`);
    }

    const download: SaveAddonFileDownloadInput = {
      id: downloadId,
      addonFileId: "",
      providerFileId: String(file.id),
      fileName: file.fileName,
      status,
      archivePath: paths.archivePath,
      extractedPath: paths.extractedPath,
      providerMetadataJson: JSON.stringify(file),
      createdAt: now,
      updatedAt: now,
    };

    if (file.displayName) download.fileDisplayName = file.displayName;
    if (file.fileDate) download.fileDate = file.fileDate;
    if (typeof file.downloadCount === "number") download.downloadCount = file.downloadCount;
    if (typeof file.fileLength === "number") download.fileLength = file.fileLength;
    if (error) download.error = error;

    downloadedFiles.push({ file, download });
    for (const pack of filePacks) {
      discoveredPacks.push({ pack, addonFileDownloadId: downloadId });
    }
  }

  const normalizedPacks = dedupeDiscoveredPacks(discoveredPacks);
  const missingDependencyError = buildMissingDependencyMessage(normalizedPacks);
  const error =
    normalizedPacks.length === 0
      ? fileErrors[0] ?? "No Bedrock pack manifests were discovered in the selected CurseForge files."
      : fileErrors.length > 0
        ? `Some CurseForge files failed: ${fileErrors.join("; ")}`
        : missingDependencyError;
  const primaryFile = selectedRelease.files.find((file) => file.id === selectedRelease.releaseFileId) ?? selectedRelease.files[0];
  if (!primaryFile) {
    throw new Error("CurseForge did not return a primary addon file.");
  }

  return {
    mod,
    file: primaryFile,
    releaseFileId: selectedRelease.releaseFileId,
    releasePaths,
    files: selectedRelease.files,
    downloadedFiles,
    error,
    discoveredPacks: normalizedPacks,
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
): Promise<{ addon: InstanceAddon; downloadedFiles: ReturnType<typeof listAddonFileDownloads>; packs: InstanceAddonPack[] }> {
  const instance = getInstance(db, instanceId);
  if (!instance) {
    throw new Error("Instance not found");
  }

  const existingAddon = input.fileId
    ? getInstanceAddonByProviderFile(db, instanceId, "curseforge", String(input.projectId), String(input.fileId))
    : undefined;
  if (existingAddon && hasNormalizedCurseForgeFiles(existingAddon)) {
    return await getAddonDetailForInstance(db, instanceId, existingAddon.id);
  }
  if (existingAddon?.status === "enabled") {
    throw new Error(`Disable ${existingAddon.name} before refreshing its CurseForge files.`);
  }

  const { mod, file, releaseFileId, releasePaths, files, downloadedFiles, error, discoveredPacks } = await fetchCurseForgeAddonProject(db, input);
  const existingReleaseAddon = getInstanceAddonByProviderFile(db, instanceId, "curseforge", String(input.projectId), String(releaseFileId));
  if (existingReleaseAddon && hasNormalizedCurseForgeFiles(existingReleaseAddon)) {
    return await getAddonDetailForInstance(db, instanceId, existingReleaseAddon.id);
  }
  if (existingReleaseAddon?.status === "enabled") {
    throw new Error(`Disable ${existingReleaseAddon.name} before refreshing its CurseForge files.`);
  }

  const now = new Date().toISOString();
  const addonId = existingReleaseAddon?.id ?? existingAddon?.id ?? createId("addon");
  const addonFileId = existingReleaseAddon?.addonFileId ?? existingAddon?.addonFileId ?? createId("afile");
  let status: SaveInstanceAddonInput["status"] = "downloaded";
  if (error) {
    status = "error";
  }

  const searchResult = mapModToSearchResult(mod, releaseFileId);
  const addon: SaveInstanceAddonInput = {
    id: addonId,
    instanceId,
    addonFileId,
    sortOrder: getNextInstanceAddonSortOrder(db, instanceId),
    autoUpdateEnabled: true,
    provider: "curseforge",
    providerProjectId: String(input.projectId),
    providerFileId: String(releaseFileId),
    name: mod.name,
    status,
    workspacePath: releasePaths.workspacePath,
    providerMetadataJson: JSON.stringify({ project: searchResult, releaseFileId, selectedFiles: files, primaryFile: file }),
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

  const downloads: SaveAddonFileDownloadInput[] = downloadedFiles.map(({ download }) => ({
    ...download,
    addonFileId,
  }));
  const packs: SaveInstanceAddonPackInput[] = discoveredPacks.map(({ pack, addonFileDownloadId }) => {
    const savedPack: SaveInstanceAddonPackInput = {
      id: createId("pack"),
      instanceId,
      addonId,
      addonFilePackId: createId("afpack"),
      addonFileDownloadId,
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

  saveInstanceAddonWithPacks(db, addon, packs, downloads);

  await appendInstanceRuntimeEvent(db, instanceId, {
    category: "settings",
    action: "addon_downloaded",
    level: status === "error" ? "warning" : "info",
    message: status === "error" ? `Downloaded ${mod.name}, but pack inspection failed.` : `Downloaded addon ${mod.name}.`,
    details: {
      provider: "curseforge",
      projectId: input.projectId,
      releaseFileId,
      fileCount: downloads.length,
      packCount: packs.length,
    },
  });

  return await getAddonDetailForInstance(db, instanceId, addonId);
}

export async function downloadCurseForgeAddonToLibrary(
  db: Database,
  input: DownloadCurseForgeAddonInput,
): Promise<{ addon: AddonLibraryItem }> {
  const existingAddon = input.fileId
    ? getAddonFileByProviderFile(db, "curseforge", String(input.projectId), String(input.fileId))
    : undefined;
  if (existingAddon && hasNormalizedCurseForgeFiles(existingAddon)) {
    return { addon: existingAddon };
  }

  const { mod, file, releaseFileId, releasePaths, files, downloadedFiles, error, discoveredPacks } = await fetchCurseForgeAddonProject(db, input);
  const existingReleaseAddon = getAddonFileByProviderFile(db, "curseforge", String(input.projectId), String(releaseFileId));
  if (existingReleaseAddon && hasNormalizedCurseForgeFiles(existingReleaseAddon)) {
    return { addon: existingReleaseAddon };
  }

  const now = new Date().toISOString();
  const searchResult = mapModToSearchResult(mod, releaseFileId);
  const addon: SaveAddonFileInput = {
    id: existingReleaseAddon?.id ?? existingAddon?.id ?? createId("afile"),
    provider: "curseforge",
    providerProjectId: String(input.projectId),
    providerFileId: String(releaseFileId),
    name: mod.name,
    workspacePath: releasePaths.workspacePath,
    providerMetadataJson: JSON.stringify({ project: searchResult, releaseFileId, selectedFiles: files, primaryFile: file }),
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

  const downloads: SaveAddonFileDownloadInput[] = downloadedFiles.map(({ download }) => ({
    ...download,
    addonFileId: addon.id,
  }));
  const packs: SaveAddonFilePackInput[] = discoveredPacks.map(({ pack, addonFileDownloadId }) =>
    mapDiscoveredAddonFilePack(addon.id, pack, now, addonFileDownloadId),
  );

  saveAddonFileWithPacks(db, addon, packs, downloads);

  const savedAddon = getAddonFileByProviderFile(db, "curseforge", String(input.projectId), String(releaseFileId));
  if (!savedAddon) {
    throw new Error("Downloaded addon was not saved in the library.");
  }

  return { addon: savedAddon };
}
