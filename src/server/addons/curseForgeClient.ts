type CurseForgePagination = {
  index: number;
  pageSize: number;
  resultCount: number;
  totalCount: number;
};

type CurseForgeApiResponse<T> = {
  data: T;
  pagination?: CurseForgePagination;
};

export type CurseForgeGame = {
  id: number;
  name: string;
  slug: string;
};

export type CurseForgeCategory = {
  id: number;
  gameId: number;
  name: string;
  slug: string;
  isClass: boolean;
  classId?: number;
};

export type CurseForgeModFile = {
  id: number;
  gameId?: number;
  modId?: number;
  isAvailable?: boolean;
  displayName: string;
  fileName: string;
  fileDate: string;
  downloadCount?: number;
  fileLength?: number;
  downloadUrl?: string;
  gameVersions?: string[];
  dependencies?: Array<{
    modId?: number;
    relationType?: number;
  }>;
};

export type CurseForgeMod = {
  id: number;
  name: string;
  slug: string;
  summary: string;
  downloadCount: number;
  links?: {
    websiteUrl?: string;
  };
  logo?: {
    thumbnailUrl?: string;
    url?: string;
  };
  authors?: Array<{
    id: number;
    name: string;
    url?: string;
  }>;
  mainFileId?: number;
  latestFiles?: CurseForgeModFile[];
  rating?: number | null;
};

export type CurseForgeSearchResult = {
  data: CurseForgeMod[];
  pagination: CurseForgePagination;
};

export type CurseForgeSearchModsInput = {
  gameId: number;
  classId: number;
  searchFilter?: string;
  sortField: number;
  sortOrder: "asc" | "desc";
  index: number;
  pageSize: number;
  gameVersion?: string;
  authorId?: number;
};

const CURSEFORGE_BASE_URL = "https://api.curseforge.com";

export class CurseForgeApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "CurseForgeApiError";
    this.status = status;
  }
}

export class CurseForgeClient {
  constructor(private readonly apiKey: string) {}

  async getGames(): Promise<CurseForgeGame[]> {
    const response = await this.get<CurseForgeApiResponse<CurseForgeGame[]>>("/v1/games", {
      pageSize: "50",
    });
    return response.data;
  }

  async getCategories(gameId: number): Promise<CurseForgeCategory[]> {
    const response = await this.get<CurseForgeApiResponse<CurseForgeCategory[]>>("/v1/categories", {
      gameId: String(gameId),
      classesOnly: "true",
    });
    return response.data;
  }

  async searchMods(input: CurseForgeSearchModsInput): Promise<CurseForgeSearchResult> {
    const response = await this.get<CurseForgeApiResponse<CurseForgeMod[]>>("/v1/mods/search", {
      gameId: String(input.gameId),
      classId: String(input.classId),
      sortField: String(input.sortField),
      sortOrder: input.sortOrder,
      index: String(input.index),
      pageSize: String(input.pageSize),
      ...(input.searchFilter ? { searchFilter: input.searchFilter } : {}),
      ...(input.gameVersion ? { gameVersion: input.gameVersion } : {}),
      ...(input.authorId ? { authorId: String(input.authorId) } : {}),
    });

    return {
      data: response.data,
      pagination: response.pagination ?? {
        index: input.index,
        pageSize: input.pageSize,
        resultCount: response.data.length,
        totalCount: response.data.length,
      },
    };
  }

  async getMod(modId: number): Promise<CurseForgeMod> {
    const response = await this.get<CurseForgeApiResponse<CurseForgeMod>>(`/v1/mods/${modId}`, {});
    return response.data;
  }

  async getModFile(modId: number, fileId: number): Promise<CurseForgeModFile> {
    const response = await this.get<CurseForgeApiResponse<CurseForgeModFile>>(`/v1/mods/${modId}/files/${fileId}`, {});
    return response.data;
  }

  async getModFiles(modId: number): Promise<CurseForgeModFile[]> {
    const files: CurseForgeModFile[] = [];
    const pageSize = 50;
    let index = 0;

    while (true) {
      const response = await this.get<CurseForgeApiResponse<CurseForgeModFile[]>>(`/v1/mods/${modId}/files`, {
        index: String(index),
        pageSize: String(pageSize),
      });
      files.push(...response.data);

      const resultCount = response.pagination?.resultCount ?? response.data.length;
      const totalCount = response.pagination?.totalCount ?? files.length;
      if (resultCount === 0 || files.length >= totalCount) {
        break;
      }

      index += resultCount;
    }

    return files;
  }

  async getModFileDownloadUrl(modId: number, fileId: number): Promise<string> {
    const response = await this.get<CurseForgeApiResponse<string>>(`/v1/mods/${modId}/files/${fileId}/download-url`, {});
    return response.data;
  }

  private async get<T>(path: string, query: Record<string, string>): Promise<T> {
    const url = new URL(path, CURSEFORGE_BASE_URL);
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value);
    }

    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "x-api-key": this.apiKey,
      },
    });

    if (!response.ok) {
      throw new CurseForgeApiError(response.status, `CurseForge request failed with status ${response.status}`);
    }

    return response.json() as Promise<T>;
  }
}
