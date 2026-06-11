import { chmod, mkdir, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize, sep } from "node:path";
import yauzl from "yauzl";
import type { Database } from "better-sqlite3";
import type { BdsInstall } from "../../shared/types/bds.js";
import type { Instance } from "../../shared/types/index.js";
import { getInstance } from "../instances/instanceService.js";
import { downloadBdsZip, cleanupBdsDownload } from "./bdsDownloadService.js";
import { getBdsInstall, saveBdsInstall } from "./bdsRepository.js";

const BDS_EXECUTABLE_NAME = "bedrock_server";

function getBdsInstallPath(instance: Instance): string {
  return `${instance.instancePath}/bds`;
}

function makeSafePath(targetDir: string, entryPath: string): string {
  const normalized = normalize(entryPath);

  if (isAbsolute(normalized)) {
    throw new Error("Zip archive contains an invalid absolute path.");
  }

  if (normalized === "" || normalized.startsWith("..") || normalized.includes(`..${sep}`)) {
    throw new Error("Zip archive contains an invalid path.");
  }

  const outputPath = join(targetDir, normalized);
  const relativePath = normalize(outputPath).slice(0, targetDir.length + 1);

  if (!outputPath.startsWith(`${targetDir}${sep}`) && outputPath !== targetDir) {
    throw new Error("Zip archive contains an invalid path.");
  }

  return outputPath;
}

function extractZipEntry(zipFile: yauzl.ZipFile, entry: yauzl.Entry, destination: string): Promise<void> {
  return new Promise((resolve, reject) => {
    zipFile.openReadStream(entry, async (error, readStream) => {
      if (error) {
        reject(error);
        return;
      }

      if (!readStream) {
        reject(new Error("Failed to read zip entry."));
        return;
      }

      const entryPath = entry.fileName;
      if (entryPath.endsWith("/")) {
        resolve();
        return;
      }

      let outputPath: string;
      try {
        outputPath = makeSafePath(destination, entryPath);
      } catch (pathError) {
        reject(pathError);
        return;
      }

      await mkdir(dirname(outputPath), { recursive: true });

      const writeStream = await import("node:fs").then((fs) => fs.createWriteStream(outputPath));
      readStream.pipe(writeStream);
      readStream.on("end", () => resolve());
      readStream.on("error", reject);
      writeStream.on("error", reject);
    });
  });
}

export async function extractBdsZip(zipPath: string, instance: Instance): Promise<void> {
  const destination = getBdsInstallPath(instance);
  await mkdir(destination, { recursive: true });

  await new Promise<void>((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (error, zipFile) => {
      if (error || !zipFile) {
        reject(error ?? new Error("Failed to open BDS zip archive."));
        return;
      }

      zipFile.readEntry();
      zipFile.on("entry", (entry) => {
        extractZipEntry(zipFile, entry, destination)
          .then(() => zipFile.readEntry())
          .catch(reject);
      });

      zipFile.on("end", () => resolve());
      zipFile.on("error", reject);
    });
  });
}

async function validateBdsInstall(instance: Instance): Promise<void> {
  const bdsPath = `${getBdsInstallPath(instance)}/${BDS_EXECUTABLE_NAME}`;
  const stats = await stat(bdsPath);

  if (!stats.isFile()) {
    throw new Error(`${BDS_EXECUTABLE_NAME} is missing after extraction.`);
  }

  await chmod(bdsPath, 0o755);
}

export async function installBdsForInstance(db: Database, instanceId: string): Promise<BdsInstall> {
  const instance = getInstance(db, instanceId);

  if (!instance) {
    throw new Error("Instance not found");
  }

  const now = new Date().toISOString();
  const initialInstall: BdsInstall = {
    instanceId,
    status: "installing",
    updatedAt: now,
  };

  saveBdsInstall(db, initialInstall);

  let download;

  try {
    download = await downloadBdsZip();
    await extractBdsZip(download.downloadPath, instance);
    await validateBdsInstall(instance);

    const successInstall: BdsInstall = {
      instanceId,
      status: "installed",
      downloadUrl: download.downloadUrl,
      installedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...(download.version ? { version: download.version } : {}),
    };

    saveBdsInstall(db, successInstall);
    return successInstall;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failedInstall: BdsInstall = {
      instanceId,
      status: "error",
      error: message,
      updatedAt: new Date().toISOString(),
    };

    saveBdsInstall(db, failedInstall);
    throw new Error(`BDS install failed: ${message}`);
  } finally {
    if (download?.downloadPath) {
      await cleanupBdsDownload(download.downloadPath).catch(() => {
        /* ignore cleanup errors */
      });
    }
  }
}

export async function getBdsStatusForInstance(db: Database, instanceId: string): Promise<BdsInstall> {
  const instance = getInstance(db, instanceId);

  if (!instance) {
    throw new Error("Instance not found");
  }

  const saved = getBdsInstall(db, instanceId);

  if (saved) {
    return saved;
  }

  const bdsPath = `${getBdsInstallPath(instance)}/${BDS_EXECUTABLE_NAME}`;

  try {
    const stats = await stat(bdsPath);
    if (stats.isFile()) {
      return {
        instanceId,
        status: "installed",
        installedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }
  } catch {
    // ignore missing file
  }

  return {
    instanceId,
    status: "not_installed",
    updatedAt: new Date().toISOString(),
  };
}
