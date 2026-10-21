import { mkdir, link, rm } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { basename, join } from "node:path";
import { randomUUID } from "node:crypto";
import { getRuntimePaths } from "../config/paths.js";
import { discoverBdsDownloadUrl, type BdsDiscoveryResult } from "./bdsDiscoveryService.js";
import { withBoundedDownload } from "../utils/boundedDownload.js";

export type BdsDownloadResult = BdsDiscoveryResult & {
  downloadPath: string;
};

const DOWNLOAD_DIR = "downloads/bds";

function getDownloadBasePath(): string {
  const runtime = getRuntimePaths();
  return `${runtime.dataDir}/${DOWNLOAD_DIR}`;
}

export async function downloadBdsZip(): Promise<BdsDownloadResult> {
  const discovery = await discoverBdsDownloadUrl();
  const url = discovery.downloadUrl;
  const filename = basename(new URL(url).pathname);
  if (!/^bedrock-server-\d+(?:\.\d+)+\.zip$/i.test(filename)) throw new Error("Invalid BDS archive filename.");

  const downloadDir = getDownloadBasePath();
  await mkdir(downloadDir, { recursive: true });
  const downloadPath = join(downloadDir, `${randomUUID()}-${filename}`);
  const temporary = `${downloadPath}.tmp`;
  try {
    await withBoundedDownload(url, { label: "BDS download", maxBytes: 512 * 1024 * 1024, timeoutMs: 300_000 }, async (chunks, signal) => {
      await pipeline(Readable.from(chunks, { objectMode: false }), createWriteStream(temporary, { flags: "wx" }), { signal });
      signal.throwIfAborted();
      // Publish a completed archive without replacing another download or installation.
      await link(temporary, downloadPath);
    });
  } finally { await rm(temporary, { force: true }); }

  return {
    ...discovery,
    downloadPath,
  };
}

export async function cleanupBdsDownload(downloadPath: string): Promise<void> {
  await rm(downloadPath, { force: true });
}
