import { fetchBoundedText } from "../utils/boundedDownload.js";

const BDS_DOWNLOAD_API = "https://net-secondary.web.minecraft-services.net/api/v1.0/download/links";
const BDS_DOWNLOAD_PAGE = "https://www.minecraft.net/en-us/download/server/bedrock";
const LINUX_DOWNLOAD_TYPE = "serverBedrockLinux";
const VERSION_REGEX = /bedrock-server-([\d.]+)\.zip/i;

export type BdsDiscoveryResult = {
  downloadUrl: string;
  version?: string;
};

type BdsDownloadLinksApiResponse = {
  result?: {
    links?: Array<{
      downloadType: string;
      downloadUrl: string;
    }>;
  };
};

async function discoverBdsDownloadUrlFromApi(): Promise<BdsDiscoveryResult> {
  const text = await fetchBoundedText(BDS_DOWNLOAD_API, {
    label: "BDS release lookup", maxBytes: 1024 * 1024, timeoutMs: 15_000,
    headers: {
      Accept: "application/json",
    },
  });

  const body = JSON.parse(text) as BdsDownloadLinksApiResponse;
  const links = Array.isArray(body?.result?.links) ? body.result.links : [];
  const linuxLink = links.find((link) => link.downloadType === LINUX_DOWNLOAD_TYPE);
  const downloadUrl = linuxLink?.downloadUrl;

  if (!downloadUrl) {
    throw new Error("Unable to discover the Ubuntu/Linux BDS download URL from API.");
  }

  const versionMatch = downloadUrl.match(VERSION_REGEX);
  const version = versionMatch ? versionMatch[1] : undefined;

  return {
    downloadUrl,
    ...(version ? { version } : {}),
  };
}

async function discoverBdsDownloadUrlFromPage(): Promise<BdsDiscoveryResult> {
  const html = await fetchBoundedText(BDS_DOWNLOAD_PAGE, {
    label: "BDS download page", maxBytes: 2 * 1024 * 1024, timeoutMs: 15_000,
  });
  const match = html.match(/https:\/\/www\.minecraft\.net\/bedrockdedicatedserver\/bin-linux\/bedrock-server-[\d.]+\.zip/i);
  const downloadUrl = match?.[0];

  if (!downloadUrl) {
    throw new Error("Unable to discover the Ubuntu/Linux BDS download URL from page HTML.");
  }

  const versionMatch = downloadUrl.match(VERSION_REGEX);
  const version = versionMatch ? versionMatch[1] : undefined;

  return {
    downloadUrl,
    ...(version ? { version } : {}),
  };
}

export async function discoverBdsDownloadUrl(): Promise<BdsDiscoveryResult> {
  try {
    return await discoverBdsDownloadUrlFromApi();
  } catch (apiError) {
    try {
      return await discoverBdsDownloadUrlFromPage();
    } catch (pageError) {
      const apiMessage = apiError instanceof Error ? apiError.message : String(apiError);
      const pageMessage = pageError instanceof Error ? pageError.message : String(pageError);
      throw new Error(
        `Unable to discover the Ubuntu/Linux BDS download URL. API error: ${apiMessage}. Page fallback error: ${pageMessage}`,
      );
    }
  }
}
