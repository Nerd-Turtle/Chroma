import { readFile } from "node:fs/promises";
import type { ChromaRelease } from "../../shared/types/index.js";

export const CHROMA_REPOSITORY = "Nerd-Turtle/Chroma";
const RELEASE_API = `https://api.github.com/repos/${CHROMA_REPOSITORY}/releases/latest`;
const STABLE_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function isStableVersion(value: unknown): value is string {
  return typeof value === "string" && value.length <= 64 && STABLE_VERSION.test(value);
}

export function isNewerVersion(candidate: string, installed: string): boolean {
  if (!isStableVersion(candidate)) throw new Error("Invalid stable release version.");
  const withoutMetadata = installed.split("+", 1)[0] ?? "";
  const base = withoutMetadata.split("-", 1)[0] ?? "";
  if (!isStableVersion(base)) throw new Error("Unable to compare the installed Chroma version.");
  const currentParts = base.split(".").map(BigInt);
  for (const [index, part] of candidate.split(".").entries()) {
    const current = currentParts[index]!;
    if (BigInt(part) !== current) return BigInt(part) > current;
  }
  return withoutMetadata.includes("-");
}

export async function getUbuntuReleasePlatform(): Promise<string | null> {
  if (process.platform !== "linux" || process.arch !== "x64") return null;
  const osRelease = await readFile("/etc/os-release", "utf8").catch(() => "");
  const id = /^ID=["']?([^\s"']+)/m.exec(osRelease)?.[1];
  const version = /^VERSION_ID=["']?([^\s"']+)/m.exec(osRelease)?.[1];
  return id === "ubuntu" && (version === "24.04" || version === "26.04") ? "ubuntu-amd64" : null;
}

export async function getInstalledChromaVersion(): Promise<string> {
  // This relative URL resolves package.json in both the source tree and release bundle.
  const manifest = JSON.parse(await readFile(new URL("../../../package.json", import.meta.url), "utf8")) as { version: string };
  return manifest.version;
}

type GitHubRelease = {
  tag_name?: unknown;
  draft?: unknown;
  prerelease?: unknown;
  published_at?: unknown;
  assets?: Array<{ name?: unknown; state?: unknown; browser_download_url?: unknown }>;
};

export async function fetchLatestChromaRelease(
  platform: string | null,
  options: { etag?: string; fetch?: typeof fetch } = {},
): Promise<{ release?: ChromaRelease | null; etag: string | null; unchanged: boolean }> {
  const response = await (options.fetch ?? fetch)(RELEASE_API, {
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "Chroma-Server-Manager",
      ...(options.etag ? { "If-None-Match": options.etag } : {}),
    },
    signal: AbortSignal.timeout(15_000),
  });
  const etag = response.headers.get("etag");
  if (response.status === 304) return { etag, unchanged: true };
  if (response.status === 404) return { release: null, etag, unchanged: false };
  if (response.status === 403 || response.status === 429) throw new Error("GitHub rate limit reached. Chroma will try again at its next scheduled check.");
  if (!response.ok) throw new Error(`GitHub update check failed (HTTP ${response.status}).`);
  const release = await response.json() as GitHubRelease;
  const version = typeof release.tag_name === "string" ? release.tag_name.replace(/^v/, "") : null;
  if (!isStableVersion(version) || release.tag_name !== `v${version}` || release.draft !== false || release.prerelease !== false) {
    throw new Error("GitHub did not return a stable Chroma release tagged vMAJOR.MINOR.PATCH.");
  }
  const baseUrl = `https://github.com/${CHROMA_REPOSITORY}/releases/download/v${version}`;
  const archive = "chroma-ubuntu-amd64.tar.gz";
  const compatible = platform === "ubuntu-amd64" && [archive, `${archive}.sha256`].every((name) =>
    Array.isArray(release.assets) && release.assets.some((asset) =>
      asset.name === name && asset.state === "uploaded" && asset.browser_download_url === `${baseUrl}/${name}`,
    ),
  );
  return {
    release: {
      version,
      url: `https://github.com/${CHROMA_REPOSITORY}/releases/tag/v${version}`,
      publishedAt: typeof release.published_at === "string" ? release.published_at : "",
      compatible,
    },
    etag,
    unchanged: false,
  };
}
