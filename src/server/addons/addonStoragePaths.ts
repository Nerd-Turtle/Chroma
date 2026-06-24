import { join } from "node:path";
import { getRuntimePaths } from "../config/paths.js";

const ADDON_DOWNLOAD_DIR = "downloads/addons";

export function sanitizeAddonPathPart(value: string): string {
  const sanitized = value.replace(/[^a-zA-Z0-9._-]/g, "_");
  return sanitized.length > 0 ? sanitized : "addon-file";
}

export function getAddonDownloadBasePath(): string {
  const runtime = getRuntimePaths();
  return join(runtime.dataDir, ADDON_DOWNLOAD_DIR);
}

export function getCurseForgeAddonStoragePaths(projectId: number, fileId: number, fileName: string) {
  const projectPath = join(getAddonDownloadBasePath(), "curseforge", "projects", String(projectId));
  const filePath = join(projectPath, "files", String(fileId));
  const archiveDirectory = join(filePath, "archive");
  const archivePath = join(archiveDirectory, sanitizeAddonPathPart(fileName));
  const extractedPath = join(filePath, "extracted");

  return {
    workspacePath: projectPath,
    filePath,
    archiveDirectory,
    archivePath,
    extractedPath,
  };
}
