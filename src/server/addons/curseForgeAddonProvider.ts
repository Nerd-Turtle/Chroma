import type { Database } from "better-sqlite3";
import type {
  CurseForgeAddonProviderStatus,
  CurseForgeAddonSearchPagination,
  CurseForgeAddonSearchRequest,
  CurseForgeAddonSearchResult,
  CurseForgeAddonSearchSort,
} from "../../shared/types/index.js";
import { getCurseForgeApiKey } from "../setup/setupService.js";
import { CurseForgeClient, type CurseForgeCategory, type CurseForgeGame, type CurseForgeMod } from "./curseForgeClient.js";

type ResolvedCurseForgeIds = {
  game: CurseForgeGame;
  addonClass: CurseForgeCategory;
};

type CachedDiscovery = {
  apiKeyHint: string;
  resolved?: ResolvedCurseForgeIds;
  message?: string;
};

const DEFAULT_SORT: CurseForgeAddonSearchSort = "popularity";
const MAX_PAGE_SIZE = 50;
let cachedDiscovery: CachedDiscovery | undefined;

function getApiKeyHint(apiKey: string): string {
  return `${apiKey.length}:${apiKey.slice(Math.max(0, apiKey.length - 4))}`;
}

function normalizeSearchText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function normalizePage(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    return 1;
  }

  return value;
}

function normalizePageSize(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    return 20;
  }

  return Math.min(value, MAX_PAGE_SIZE);
}

function normalizeAuthorId(value: number | undefined): number | undefined {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    return undefined;
  }

  return value;
}

function mapSortField(sort: CurseForgeAddonSearchSort | undefined): number {
  switch (sort ?? DEFAULT_SORT) {
    case "relevance":
      return 1;
    case "last_updated":
      return 3;
    case "total_downloads":
      return 6;
    case "released_date":
      return 11;
    case "rating":
      return 12;
    case "popularity":
    default:
      return 2;
  }
}

function findBedrockGame(games: CurseForgeGame[]): CurseForgeGame | undefined {
  return games.find((game) => game.slug === "minecraft-bedrock")
    ?? games.find((game) => game.name.toLowerCase() === "minecraft bedrock")
    ?? games.find((game) => game.slug.includes("bedrock") && game.name.toLowerCase().includes("minecraft"));
}

function findAddonClass(categories: CurseForgeCategory[]): CurseForgeCategory | undefined {
  return categories.find((category) => category.isClass && category.slug === "addons")
    ?? categories.find((category) => category.isClass && category.name.toLowerCase() === "addons")
    ?? categories.find((category) => category.isClass && category.slug.includes("addon"));
}

function toProviderStatus(apiKey: string | undefined, discovery: CachedDiscovery | undefined): CurseForgeAddonProviderStatus {
  if (!apiKey) {
    return {
      configured: false,
      resolved: false,
      message: "CurseForge API key is not configured.",
    };
  }

  if (!discovery?.resolved) {
    return {
      configured: true,
      resolved: false,
      message: discovery?.message ?? "CurseForge Bedrock addon IDs have not been resolved yet.",
    };
  }

  return {
    configured: true,
    resolved: true,
    gameId: discovery.resolved.game.id,
    gameName: discovery.resolved.game.name,
    gameSlug: discovery.resolved.game.slug,
    classId: discovery.resolved.addonClass.id,
    className: discovery.resolved.addonClass.name,
    classSlug: discovery.resolved.addonClass.slug,
  };
}

async function resolveCurseForgeIds(apiKey: string): Promise<CachedDiscovery> {
  const apiKeyHint = getApiKeyHint(apiKey);
  if (cachedDiscovery?.apiKeyHint === apiKeyHint) {
    return cachedDiscovery;
  }

  const client = new CurseForgeClient(apiKey);
  const games = await client.getGames();
  const game = findBedrockGame(games);

  if (!game) {
    cachedDiscovery = {
      apiKeyHint,
      message: "CurseForge did not return a Minecraft Bedrock game for this API key.",
    };
    return cachedDiscovery;
  }

  const categories = await client.getCategories(game.id);
  const addonClass = findAddonClass(categories);

  if (!addonClass) {
    cachedDiscovery = {
      apiKeyHint,
      message: "CurseForge did not return an Addons class for Minecraft Bedrock.",
    };
    return cachedDiscovery;
  }

  cachedDiscovery = {
    apiKeyHint,
    resolved: {
      game,
      addonClass,
    },
  };
  return cachedDiscovery;
}

function mapSearchResult(mod: CurseForgeMod): CurseForgeAddonSearchResult {
  const latestFile = mod.latestFiles?.find((file) => file.id === mod.mainFileId) ?? mod.latestFiles?.[0];

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

export async function getCurseForgeAddonProviderStatus(db: Database): Promise<CurseForgeAddonProviderStatus> {
  const apiKey = getCurseForgeApiKey(db);
  if (!apiKey) {
    return toProviderStatus(undefined, undefined);
  }

  try {
    const discovery = await resolveCurseForgeIds(apiKey);
    return toProviderStatus(apiKey, discovery);
  } catch {
    return {
      configured: true,
      resolved: false,
      message: "CurseForge provider discovery failed. Check the API key and try again.",
    };
  }
}

export async function searchCurseForgeAddons(
  db: Database,
  input: CurseForgeAddonSearchRequest,
): Promise<{
  provider: CurseForgeAddonProviderStatus;
  results: CurseForgeAddonSearchResult[];
  pagination: CurseForgeAddonSearchPagination;
}> {
  const apiKey = getCurseForgeApiKey(db);
  if (!apiKey) {
    throw new Error("CurseForge API key is not configured");
  }

  const discovery = await resolveCurseForgeIds(apiKey);
  const provider = toProviderStatus(apiKey, discovery);
  if (!discovery.resolved) {
    throw new Error(provider.message ?? "CurseForge provider is not resolved");
  }

  const page = normalizePage(input.page);
  const pageSize = normalizePageSize(input.pageSize);
  const index = (page - 1) * pageSize;
  const client = new CurseForgeClient(apiKey);
  const searchFilter = normalizeSearchText(input.q);
  const gameVersion = normalizeSearchText(input.gameVersion);
  const authorId = normalizeAuthorId(input.authorId);
  const result = await client.searchMods({
    gameId: discovery.resolved.game.id,
    classId: discovery.resolved.addonClass.id,
    sortField: mapSortField(input.sort),
    sortOrder: "desc",
    index,
    pageSize,
    ...(searchFilter ? { searchFilter } : {}),
    ...(gameVersion ? { gameVersion } : {}),
    ...(authorId ? { authorId } : {}),
  });

  return {
    provider,
    results: result.data.map(mapSearchResult),
    pagination: {
      page,
      pageSize: result.pagination.pageSize,
      resultCount: result.pagination.resultCount,
      totalCount: result.pagination.totalCount,
    },
  };
}
