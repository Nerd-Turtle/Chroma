import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Database } from "better-sqlite3";
import type { Instance } from "../../shared/types/index.js";
import { getInstance } from "../instances/instanceService.js";

const CURRENT_BDS_LOG_FILE_NAME = "bds-current.log";
const HISTORICAL_BDS_LOG_PREFIX = "bds-";
const HISTORICAL_BDS_LOG_SUFFIX = ".log";
const MAX_CURRENT_BDS_LOG_BYTES = 5 * 1024 * 1024;
const MAX_HISTORICAL_BDS_LOG_FILES = 10;

export type BdsLogFileSummary = {
  fileName: string;
  current: boolean;
  sizeBytes: number;
  updatedAt: string;
};

export type BdsLogTail = {
  fileName: string;
  lines: string[];
};

export type BdsLogPage = {
  fileName: string;
  lines: string[];
  offset: number;
  limit: number;
  totalLines: number;
  hasPrevious: boolean;
  hasNext: boolean;
};

function getLogsDirectory(instance: Instance): string {
  return join(instance.instancePath, "csm", "logs");
}

function getCurrentLogPath(instance: Instance): string {
  return join(getLogsDirectory(instance), CURRENT_BDS_LOG_FILE_NAME);
}

function getHistoricalLogPath(instance: Instance, fileName: string): string {
  return join(getLogsDirectory(instance), fileName);
}

function formatLogTimestamp(date: Date): string {
  const pad = (value: number, width = 2) => String(value).padStart(width, "0");
  return [
    date.getUTCFullYear(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate()),
    "-",
    pad(date.getUTCHours()),
    pad(date.getUTCMinutes()),
    pad(date.getUTCSeconds()),
    "-",
    pad(date.getUTCMilliseconds(), 3),
  ].join("");
}

function splitLogLines(content: string): string[] {
  return content
    .replace(/\r/g, "")
    .split("\n")
    .filter((line, index, lines) => !(index === lines.length - 1 && line === ""));
}

function isHistoricalLogFileName(fileName: string): boolean {
  return fileName.startsWith(HISTORICAL_BDS_LOG_PREFIX) && fileName.endsWith(HISTORICAL_BDS_LOG_SUFFIX);
}

function isAllowedLogFileName(fileName: string): boolean {
  return fileName === CURRENT_BDS_LOG_FILE_NAME || isHistoricalLogFileName(fileName);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function ensureLogsDirectory(instance: Instance): Promise<void> {
  await mkdir(getLogsDirectory(instance), { recursive: true });
}

async function pruneHistoricalLogs(instance: Instance): Promise<void> {
  const files = await listBdsLogFilesForInstance(instance);
  const historical = files.filter((file) => !file.current);
  if (historical.length <= MAX_HISTORICAL_BDS_LOG_FILES) {
    return;
  }

  for (const file of historical.slice(MAX_HISTORICAL_BDS_LOG_FILES)) {
    await unlink(getHistoricalLogPath(instance, file.fileName)).catch(() => undefined);
  }
}

async function rotateCurrentLog(instance: Instance): Promise<void> {
  const currentLogPath = getCurrentLogPath(instance);
  if (!(await pathExists(currentLogPath))) {
    return;
  }

  const currentStats = await stat(currentLogPath);
  if (currentStats.size === 0) {
    return;
  }

  const targetFileName = `${HISTORICAL_BDS_LOG_PREFIX}${formatLogTimestamp(new Date())}${HISTORICAL_BDS_LOG_SUFFIX}`;
  let targetPath = getHistoricalLogPath(instance, targetFileName);
  let collisionCounter = 1;

  while (await pathExists(targetPath)) {
    targetPath = getHistoricalLogPath(
      instance,
      `${HISTORICAL_BDS_LOG_PREFIX}${formatLogTimestamp(new Date())}-${collisionCounter}${HISTORICAL_BDS_LOG_SUFFIX}`,
    );
    collisionCounter += 1;
  }

  await rename(currentLogPath, targetPath);
  await pruneHistoricalLogs(instance);
}

async function readLogLines(instance: Instance, fileName: string): Promise<string[]> {
  if (!isAllowedLogFileName(fileName)) {
    throw new Error("Invalid log file");
  }

  const filePath =
    fileName === CURRENT_BDS_LOG_FILE_NAME ? getCurrentLogPath(instance) : getHistoricalLogPath(instance, fileName);

  if (!(await pathExists(filePath))) {
    return [];
  }

  const content = await readFile(filePath, "utf8");
  return splitLogLines(content);
}

export async function prepareBdsCurrentLog(instance: Instance): Promise<number> {
  await ensureLogsDirectory(instance);
  await rotateCurrentLog(instance);

  const currentLogPath = getCurrentLogPath(instance);
  if (!(await pathExists(currentLogPath))) {
    await writeFile(currentLogPath, "", "utf8");
  }

  const currentStats = await stat(currentLogPath);
  return currentStats.size;
}

export async function appendBdsLogChunk(
  instance: Instance,
  chunk: string,
  currentSizeBytes: number,
): Promise<number> {
  await ensureLogsDirectory(instance);

  const nextChunkBytes = Buffer.byteLength(chunk, "utf8");
  let nextSize = currentSizeBytes;
  const currentLogPath = getCurrentLogPath(instance);

  if (nextSize > 0 && nextSize + nextChunkBytes > MAX_CURRENT_BDS_LOG_BYTES) {
    await rotateCurrentLog(instance);
    nextSize = 0;
  }

  await writeFile(currentLogPath, chunk, { flag: "a" });
  return nextSize + nextChunkBytes;
}

export async function listBdsLogFilesForInstance(instance: Instance): Promise<BdsLogFileSummary[]> {
  await ensureLogsDirectory(instance);

  const directoryEntries = await readdir(getLogsDirectory(instance), { withFileTypes: true });
  const files = await Promise.all(
    directoryEntries
      .filter((entry) => entry.isFile() && isAllowedLogFileName(entry.name))
      .map(async (entry) => {
        const filePath =
          entry.name === CURRENT_BDS_LOG_FILE_NAME
            ? getCurrentLogPath(instance)
            : getHistoricalLogPath(instance, entry.name);
        const fileStats = await stat(filePath);

        return {
          fileName: entry.name,
          current: entry.name === CURRENT_BDS_LOG_FILE_NAME,
          sizeBytes: fileStats.size,
          updatedAt: new Date(fileStats.mtimeMs).toISOString(),
        } satisfies BdsLogFileSummary;
      }),
  );

  return files.sort((left, right) => {
    if (left.current && !right.current) {
      return -1;
    }

    if (!left.current && right.current) {
      return 1;
    }

    return right.updatedAt.localeCompare(left.updatedAt);
  });
}

export async function getCurrentBdsLogTail(instance: Instance, limit: number): Promise<BdsLogTail> {
  const lines = await readLogLines(instance, CURRENT_BDS_LOG_FILE_NAME);
  return {
    fileName: CURRENT_BDS_LOG_FILE_NAME,
    lines: lines.slice(-limit),
  };
}

export async function getBdsLogPage(instance: Instance, fileName: string, offset: number, limit: number): Promise<BdsLogPage> {
  const lines = await readLogLines(instance, fileName);
  const safeOffset = Math.max(0, Math.min(offset, Math.max(0, lines.length - 1)));
  const safeLimit = Math.max(1, limit);
  const pageLines = lines.slice(safeOffset, safeOffset + safeLimit);

  return {
    fileName,
    lines: pageLines,
    offset: safeOffset,
    limit: safeLimit,
    totalLines: lines.length,
    hasPrevious: safeOffset > 0,
    hasNext: safeOffset + safeLimit < lines.length,
  };
}

export async function listBdsLogFiles(db: Database, instanceId: string): Promise<BdsLogFileSummary[]> {
  const instance = getInstance(db, instanceId);
  if (!instance) {
    throw new Error("Instance not found");
  }

  return await listBdsLogFilesForInstance(instance);
}

export async function getInstanceCurrentBdsLogTail(db: Database, instanceId: string, limit: number): Promise<BdsLogTail> {
  const instance = getInstance(db, instanceId);
  if (!instance) {
    throw new Error("Instance not found");
  }

  return await getCurrentBdsLogTail(instance, limit);
}

export async function getInstanceBdsLogPage(
  db: Database,
  instanceId: string,
  fileName: string,
  offset: number,
  limit: number,
): Promise<BdsLogPage> {
  const instance = getInstance(db, instanceId);
  if (!instance) {
    throw new Error("Instance not found");
  }

  return await getBdsLogPage(instance, fileName, offset, limit);
}

export {
  CURRENT_BDS_LOG_FILE_NAME,
  MAX_CURRENT_BDS_LOG_BYTES,
  MAX_HISTORICAL_BDS_LOG_FILES,
};
