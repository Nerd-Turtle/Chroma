import type { Database } from "better-sqlite3";
import type { Instance, InstanceAddon } from "../../shared/types/index.js";
import { getAddonFile, listAddonFileDownloads, listAddonFilePacks, listInstanceAddonPacks, listInstanceAddons } from "./addonRepository.js";
import type { CurseForgeModFile } from "./curseForgeClient.js";
import { getAddonUpdateSettings } from "./addonUpdateSettingsService.js";
import { isAllowedAddonRelease } from "./addonReleasePolicy.js";

export function parseEngineVersion(value: string): number[] | null {
  return /^\d+\.\d+\.\d+(?:\.\d+)?$/.test(value) ? value.split(".").map(Number).slice(0, 3) : null;
}

export function readReleaseFiles(db: Database, fileId: string): CurseForgeModFile[] {
  const row = db.prepare("SELECT provider_metadata_json FROM addon_files WHERE id=?").get(fileId) as { provider_metadata_json: string | null } | undefined;
  if (!row?.provider_metadata_json) return [];
  try {
    const metadata = JSON.parse(row.provider_metadata_json) as { selectedFiles?: CurseForgeModFile[] };
    return Array.isArray(metadata.selectedFiles) ? metadata.selectedFiles : [];
  } catch { return []; }
}

export function getAddonUpdateCompatibilityIssue(db: Database, instance: Instance, addon: InstanceAddon, targetId: string): string | null {
  const target = getAddonFile(db, targetId);
  if (!target || target.error) return "The downloaded release is missing or has file errors.";
  if (!addon.addonFileId || addon.librarySyncStatus !== "linked") return "Link this restored addon to its exact library version before updating.";
  if (target.provider !== addon.provider || target.providerProjectId !== addon.providerProjectId) return "The downloaded release belongs to another addon.";
  const engine = parseEngineVersion(instance.bdsVersion);
  if (!engine) return "The instance Bedrock version cannot be verified.";
  const files = readReleaseFiles(db, targetId);
  const { releaseChannel } = getAddonUpdateSettings(db);
  if (files.length === 0 || files.some((file) => !isAllowedAddonRelease(file, releaseChannel))) return "This release is unavailable or excluded by the addon release channel setting.";
  if (files.some((file) => !(file.gameVersions ?? []).some((version) => parseEngineVersion(version)?.join(".") === engine.join(".")))) {
    return "The provider has not confirmed this release for the instance's Bedrock version.";
  }
  if (files.some((file) => !file.hashes?.some((hash) => hash.algo === 1 || hash.algo === 2))) return "Provider checksums are missing; review this release manually.";
  // CurseForge relation types: https://docs.curseforge.com/rest-api/#tocS_FileRelationType
  if (files.some((file) => file.dependencies?.some((dependency) => [1, 3].includes(dependency.relationType ?? 0) && String(dependency.modId) !== addon.providerProjectId))) {
    return "The provider lists required external addons; review this stack manually.";
  }
  if (files.some((file) => file.dependencies?.some((dependency) => dependency.relationType === 5))) return "The provider declares an incompatible addon; review this stack manually.";
  const downloads = listAddonFileDownloads(db, targetId);
  if (downloads.length !== files.length || downloads.some((file) => file.status !== "downloaded")) return "The complete release has not downloaded successfully.";
  const packs = listAddonFilePacks(db, targetId);
  if (packs.length === 0 || packs.some((pack) => !["behavior", "resource"].includes(pack.packType))) return "This release contains unsupported pack types.";
  const oldPacks = listInstanceAddonPacks(db, instance.id, addon.id);
  if (oldPacks.some((old) => !packs.some((pack) => pack.headerUuid.toLowerCase() === old.headerUuid.toLowerCase() && pack.packType === old.packType))) {
    return "Pack identities changed or a companion pack is missing; review this release manually.";
  }
  const otherAddons = listInstanceAddons(db, instance.id).filter((item) => item.id !== addon.id && item.status === "enabled");
  if (listInstanceAddons(db, instance.id).some((item) => item.id !== addon.id && item.addonFileId === targetId)) return "This instance already links to the target release; review its addon links manually.";
  const otherPacks = otherAddons.flatMap((item) => listInstanceAddonPacks(db, instance.id, item.id)).filter((pack) => pack.status === "enabled");
  const identifiers = new Set<string>();
  for (const pack of packs) {
    const uuid = pack.headerUuid.toLowerCase();
    if (identifiers.has(uuid) || otherPacks.some((other) => other.headerUuid.toLowerCase() === uuid)) return "The release conflicts with another pack identity or contains multiple versions of the same pack.";
    identifiers.add(uuid);
    const old = oldPacks.find((item) => item.headerUuid.toLowerCase() === uuid);
    if (old) {
      const next = JSON.parse(pack.headerVersionJson) as number[];
      let compared = 0;
      for (let index = 0; index < 3 && compared === 0; index++) compared = (next[index] ?? 0) - (old.headerVersion[index] ?? 0);
      if (compared < 0) return "The downloaded pack version would be a downgrade; review it manually.";
    }
    const minimum = pack.minEngineVersionJson ? JSON.parse(pack.minEngineVersionJson) as number[] : null;
    if (!minimum) return "A pack does not declare its minimum Bedrock version; review it manually.";
    let comparison = 0;
    for (let index = 0; index < 3 && comparison === 0; index++) comparison = (minimum[index] ?? 0) - (engine[index] ?? 0);
    if (comparison > 0) return "A pack requires a newer Bedrock server.";
    let manifest: { dependencies?: Array<{ uuid?: string; version?: number[] | string; module_name?: string }> };
    try { manifest = JSON.parse(pack.manifestJson ?? "{}"); }
    catch { return "A pack manifest cannot be validated."; }
    if (!manifest || typeof manifest !== "object") return "A pack manifest cannot be validated.";
    if (manifest.dependencies !== undefined && !Array.isArray(manifest.dependencies)) return "Pack dependency metadata cannot be validated.";
    for (const dependency of manifest.dependencies ?? []) {
      if (!dependency || typeof dependency !== "object") return "Pack dependency metadata cannot be validated.";
      if (dependency.module_name !== undefined) return "A Script API dependency requires manual compatibility review.";
      if (typeof dependency.uuid !== "string" || !(typeof dependency.version === "string" || (Array.isArray(dependency.version) && dependency.version.length === 3 && dependency.version.every((part) => Number.isInteger(part) && part >= 0)))) return "Pack dependency metadata cannot be validated.";
      if (dependency.uuid) {
        const wantedVersion = Array.isArray(dependency.version) ? dependency.version.join(".") : dependency.version;
        const available = packs.some((item) => item.headerUuid.toLowerCase() === dependency.uuid!.toLowerCase() && (JSON.parse(item.headerVersionJson) as number[]).join(".") === wantedVersion)
          || otherPacks.some((item) => item.headerUuid.toLowerCase() === dependency.uuid!.toLowerCase() && item.headerVersion.join(".") === wantedVersion);
        if (!available) return "A required pack dependency or its exact version is missing.";
      }
    }
  }
  if (addon.status === "enabled") {
    const dependents = db.prepare(`SELECT COALESCE(file.manifest_json,pack.manifest_json) AS manifest FROM instance_addon_packs pack
      LEFT JOIN addon_file_packs file ON file.id=pack.addon_file_pack_id WHERE pack.instance_id=? AND pack.addon_id!=? AND pack.status='enabled'`).all(instance.id, addon.id) as Array<{ manifest: string | null }>;
    for (const dependent of dependents) {
      let dependencies: Array<{ uuid?: string; version?: number[] | string }>;
      try {
        const parsed = JSON.parse(dependent.manifest ?? "{}") as { dependencies?: unknown };
        if (!parsed || typeof parsed !== "object") return "Another enabled pack has uncertain dependency metadata.";
        if (parsed.dependencies !== undefined && !Array.isArray(parsed.dependencies)) return "Another enabled pack has uncertain dependency metadata.";
        dependencies = parsed.dependencies as typeof dependencies ?? [];
      } catch { return "Another enabled pack has uncertain dependency metadata."; }
      for (const dependency of dependencies) {
        if (!dependency || typeof dependency !== "object") return "Another enabled pack has uncertain dependency metadata.";
        if (typeof dependency.uuid !== "string") continue;
        const replacement = packs.find((pack) => pack.headerUuid.toLowerCase() === dependency.uuid!.toLowerCase());
        const wanted = Array.isArray(dependency.version) ? dependency.version.join(".") : dependency.version;
        if (replacement && (JSON.parse(replacement.headerVersionJson) as number[]).join(".") !== wanted) return "Another enabled addon requires the previous pack version; update this stack manually.";
      }
    }
  }
  return null;
}
