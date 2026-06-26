import type { InstanceStatus, InstanceUpdateCheckFrequency, InstanceUpdateCheckWeekday } from "./instance.js";

export type AddonProvider = "curseforge" | "manual";

export type InstanceAddonStatus = "downloaded" | "enabled" | "disabled" | "error";

export type InstanceAddonPackType = "behavior" | "resource" | "skin" | "unknown";

export type InstanceAddonPackStatus = "downloaded" | "enabled" | "disabled" | "unsupported" | "error";

export type CurseForgeAddonSearchSort = "relevance" | "popularity" | "last_updated" | "total_downloads" | "released_date" | "rating";

export type InstanceAddonPackCounts = {
  behavior: number;
  resource: number;
  skin: number;
  unknown: number;
  unsupported: number;
};

export type AddonLibraryItem = {
  id: string;
  provider: AddonProvider;
  providerProjectId: string;
  providerFileId: string;
  name: string;
  slug?: string;
  summary?: string;
  websiteUrl?: string;
  logoUrl?: string;
  fileName?: string;
  fileDisplayName?: string;
  fileDate?: string;
  downloadCount?: number;
  workspacePath: string;
  archivePath?: string;
  extractedPath?: string;
  error?: string;
  packCounts: InstanceAddonPackCounts;
  registeredInstanceCount: number;
  createdAt: string;
  updatedAt: string;
};

export type InstanceAddon = {
  id: string;
  instanceId: string;
  addonFileId: string;
  sortOrder: number;
  autoUpdateEnabled: boolean;
  provider: AddonProvider;
  providerProjectId: string;
  providerFileId: string;
  name: string;
  slug?: string;
  summary?: string;
  websiteUrl?: string;
  logoUrl?: string;
  fileName?: string;
  fileDisplayName?: string;
  fileDate?: string;
  downloadCount?: number;
  status: InstanceAddonStatus;
  workspacePath: string;
  archivePath?: string;
  extractedPath?: string;
  error?: string;
  packCounts: InstanceAddonPackCounts;
  createdAt: string;
  updatedAt: string;
};

export type InstanceAddonPack = {
  id: string;
  instanceId: string;
  addonId: string;
  addonFilePackId: string;
  packType: InstanceAddonPackType;
  name?: string;
  description?: string;
  headerUuid: string;
  headerVersion: number[];
  minEngineVersion?: number[];
  sourcePath: string;
  enabledPath?: string;
  status: InstanceAddonPackStatus;
  enabledAt?: string;
  disabledAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type CurseForgeAddonProviderStatus = {
  configured: boolean;
  resolved: boolean;
  gameId?: number;
  gameName?: string;
  gameSlug?: string;
  classId?: number;
  className?: string;
  classSlug?: string;
  message?: string;
};

export type CurseForgeAddonSearchAuthor = {
  id: number;
  name: string;
  url?: string;
};

export type CurseForgeAddonSearchResult = {
  projectId: number;
  name: string;
  slug: string;
  summary: string;
  websiteUrl?: string;
  logoUrl?: string;
  authors: CurseForgeAddonSearchAuthor[];
  downloadCount: number;
  latestFileId?: number;
  latestFileName?: string;
  latestFileDisplayName?: string;
  latestFileDate?: string;
  latestGameVersions: string[];
  rating?: number;
};

export type CurseForgeAddonSearchPagination = {
  page: number;
  pageSize: number;
  resultCount: number;
  totalCount: number;
};

export type AddonUpdateSettings = {
  automaticChecksEnabled: boolean;
  updateCheckFrequency: InstanceUpdateCheckFrequency;
  updateCheckTime: string;
  updateCheckWeekday: InstanceUpdateCheckWeekday;
};

export type AddonLibraryLinkedInstance = {
  instanceId: string;
  friendlyName: string;
  status: InstanceStatus;
  linked: boolean;
  autoUpdateEnabled: boolean;
};
