import { mkdir, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { getRuntimePaths } from "../config/paths.js";
import { discoverBdsDownloadUrl, type BdsDiscoveryResult } from "./bdsDiscoveryService.js";

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
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to download BDS zip: ${response.status} ${response.statusText}`);
  }

  const filename = url.split("/").pop();
  if (!filename) {
    throw new Error("Unable to determine BDS zip filename from URL.");
  }

  const downloadDir = getDownloadBasePath();
  await mkdir(downloadDir, { recursive: true });
  const downloadPath = `${downloadDir}/${randomUUID()}-${filename}`;

  const buffer = Buffer.from(await response.arrayBuffer());
  await writeFile(downloadPath, buffer);

  return {
    ...discovery,
    downloadPath,
  };
}

export async function cleanupBdsDownload(downloadPath: string): Promise<void> {
  await rm(downloadPath, { force: true });
}
