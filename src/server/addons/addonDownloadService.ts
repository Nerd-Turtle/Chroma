import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { link, lstat, rm } from "node:fs/promises";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { CurseForgeModFile } from "./curseForgeClient.js";
import type { Database } from "better-sqlite3";

const MAX_DOWNLOAD_BYTES = 512 * 1024 * 1024;
const downloads = new WeakMap<Database, Map<number, Promise<void>>>();

export async function runAddonProjectDownload<T>(db: Database, projectId: number, operation: () => Promise<T>): Promise<T> {
  const projects = downloads.get(db) ?? new Map<number, Promise<void>>();
  downloads.set(db, projects);
  const previous = projects.get(projectId);
  let release!: () => void;
  const reservation = new Promise<void>((resolve) => { release = resolve; });
  projects.set(projectId, reservation);
  await previous;
  try { return await operation(); }
  finally { release(); if (projects.get(projectId) === reservation) projects.delete(projectId); }
}

export async function downloadAddonFile(url: string, destination: string, file?: CurseForgeModFile): Promise<void> {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) throw new Error("Addon downloads require an HTTPS provider URL.");
  if (file?.fileLength && file.fileLength > MAX_DOWNLOAD_BYTES) throw new Error("Addon download exceeds the 512 MiB limit.");
  const temporary = `${destination}.${randomUUID()}.tmp`;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
    if (!response.ok || !response.body || Number(response.headers.get("content-length")) > MAX_DOWNLOAD_BYTES) {
      await response.body?.cancel();
      throw new Error(response.ok ? "Addon download exceeds the 512 MiB limit." : `CurseForge file download failed with status ${response.status}`);
    }
    let bytes = 0;
    const digest = file?.hashes?.find((hash) => hash.algo === 1) ?? file?.hashes?.find((hash) => hash.algo === 2);
    const hash = digest ? createHash(digest.algo === 1 ? "sha1" : "md5") : null;
    await pipeline(Readable.fromWeb(response.body as import("node:stream/web").ReadableStream), new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        bytes += chunk.length;
        if (bytes > MAX_DOWNLOAD_BYTES) { callback(new Error("Addon download exceeds the 512 MiB limit.")); return; }
        hash?.update(chunk);
        callback(null, chunk);
      },
    }), createWriteStream(temporary, { flags: "wx" }));
    if (file?.fileLength && bytes !== file.fileLength) throw new Error("Addon download size does not match its provider metadata.");
    if (hash && hash.digest("hex").toLowerCase() !== digest!.value.toLowerCase()) throw new Error("Addon download checksum does not match its provider metadata.");
    // A hard link publishes the completed download without overwriting another request's file.
    try { await link(temporary, destination); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST" || !file || !await verifyDownloadedAddon(destination, file)) throw error;
    }
  } finally { await rm(temporary, { force: true }); }
}

export async function verifyDownloadedAddon(path: string, file: CurseForgeModFile): Promise<boolean> {
  const info = await lstat(path);
  if (!info.isFile() || info.size > MAX_DOWNLOAD_BYTES || (file.fileLength && info.size !== file.fileLength)) return false;
  const digest = file.hashes?.find((hash) => hash.algo === 1) ?? file.hashes?.find((hash) => hash.algo === 2);
  if (!digest) return false;
  const hash = createHash(digest.algo === 1 ? "sha1" : "md5");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex").toLowerCase() === digest.value.toLowerCase();
}
