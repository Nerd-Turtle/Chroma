import { createWriteStream } from "node:fs";
import { mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, normalize, relative, sep } from "node:path";
import yauzl from "yauzl";
import type { InstanceAddonPackType } from "../../shared/types/index.js";

export type DiscoveredAddonPack = {
  packType: InstanceAddonPackType;
  status: "downloaded" | "unsupported" | "error";
  name?: string;
  description?: string;
  headerUuid: string;
  headerVersion: number[];
  minEngineVersion?: number[];
  dependencyUuids: string[];
  sourcePath: string;
  manifestJson: string;
};

type BedrockManifest = {
  header?: {
    name?: unknown;
    description?: unknown;
    uuid?: unknown;
    version?: unknown;
    min_engine_version?: unknown;
  };
  modules?: Array<{
    type?: unknown;
  }>;
  dependencies?: Array<{
    uuid?: unknown;
  }>;
};

const MAX_ARCHIVE_ENTRIES = 20000;
const MAX_EXTRACTED_BYTES = 2 * 1024 * 1024 * 1024;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function stripJsonComments(json: string): string {
  let result = "";
  let inString = false;
  let escaped = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let index = 0; index < json.length; index += 1) {
    const character = json[index] ?? "";
    const nextCharacter = json[index + 1];

    if (inLineComment) {
      if (character === "\n" || character === "\r") {
        inLineComment = false;
        result += character;
      }
      continue;
    }

    if (inBlockComment) {
      if (character === "*" && nextCharacter === "/") {
        inBlockComment = false;
        index += 1;
      } else if (character === "\n" || character === "\r") {
        result += character;
      }
      continue;
    }

    if (inString) {
      result += character;
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === "\"") {
        inString = false;
      }
      continue;
    }

    if (character === "\"") {
      inString = true;
      result += character;
      continue;
    }

    if (character === "/" && nextCharacter === "/") {
      inLineComment = true;
      index += 1;
      continue;
    }

    if (character === "/" && nextCharacter === "*") {
      inBlockComment = true;
      index += 1;
      continue;
    }

    result += character;
  }

  return result;
}

function extractLeadingJsonObject(json: string): string | undefined {
  let inString = false;
  let escaped = false;
  let startIndex = -1;
  let depth = 0;

  for (let index = 0; index < json.length; index += 1) {
    const character = json[index] ?? "";

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === "\"") {
        inString = false;
      }
      continue;
    }

    if (character === "\"") {
      inString = true;
      continue;
    }

    if (startIndex === -1) {
      if (/\s/.test(character)) {
        continue;
      }

      if (character !== "{") {
        return undefined;
      }

      startIndex = index;
      depth = 1;
      continue;
    }

    if (character === "{") {
      depth += 1;
      continue;
    }

    if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        return json.slice(startIndex, index + 1);
      }
    }
  }

  return undefined;
}

function makeSafePath(targetDir: string, entryPath: string): string {
  const normalized = normalize(entryPath);

  if (isAbsolute(normalized)) {
    throw new Error("Addon archive contains an invalid absolute path.");
  }

  if (normalized === "" || normalized.startsWith("..") || normalized.includes(`..${sep}`)) {
    throw new Error("Addon archive contains an invalid path.");
  }

  const outputPath = join(targetDir, normalized);
  const relativeOutput = relative(targetDir, outputPath);

  if (relativeOutput.startsWith("..") || isAbsolute(relativeOutput)) {
    throw new Error("Addon archive contains an invalid path.");
  }

  return outputPath;
}

function isZipSymlink(entry: yauzl.Entry): boolean {
  const mode = (entry.externalFileAttributes >> 16) & 0o170000;
  return mode === 0o120000;
}

function extractZipEntry(zipFile: yauzl.ZipFile, entry: yauzl.Entry, destination: string): Promise<number> {
  return new Promise((resolve, reject) => {
    if (isZipSymlink(entry)) {
      reject(new Error("Addon archive contains a symlink, which is not supported."));
      return;
    }

    if (entry.fileName.endsWith("/")) {
      resolve(0);
      return;
    }

    let outputPath: string;
    try {
      outputPath = makeSafePath(destination, entry.fileName);
    } catch (error) {
      reject(error);
      return;
    }

    zipFile.openReadStream(entry, async (error, readStream) => {
      if (error || !readStream) {
        reject(error ?? new Error("Failed to read addon archive entry."));
        return;
      }

      try {
        await mkdir(dirname(outputPath), { recursive: true });
      } catch (mkdirError) {
        reject(mkdirError);
        return;
      }

      const writeStream = createWriteStream(outputPath, { flags: "wx" });
      readStream.pipe(writeStream);
      readStream.on("error", reject);
      writeStream.on("error", reject);
      writeStream.on("finish", () => resolve(entry.uncompressedSize));
    });
  });
}

async function extractZipArchive(zipPath: string, destination: string): Promise<void> {
  await mkdir(destination, { recursive: true });

  await new Promise<void>((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (error, zipFile) => {
      if (error || !zipFile) {
        reject(error ?? new Error("Failed to open addon archive."));
        return;
      }

      let entryCount = 0;
      let extractedBytes = 0;

      zipFile.readEntry();
      zipFile.on("entry", (entry) => {
        entryCount += 1;
        extractedBytes += entry.uncompressedSize;

        if (entryCount > MAX_ARCHIVE_ENTRIES || extractedBytes > MAX_EXTRACTED_BYTES) {
          reject(new Error("Addon archive is larger than Chroma currently allows."));
          return;
        }

        extractZipEntry(zipFile, entry, destination)
          .then(() => zipFile.readEntry())
          .catch(reject);
      });

      zipFile.on("end", () => resolve());
      zipFile.on("error", reject);
    });
  });
}

async function findFiles(root: string, fileName: string): Promise<string[]> {
  const results: string[] = [];

  async function visit(directory: string) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error("Extracted addon contains a symlink, which is not supported.");
      }

      if (entry.isDirectory()) {
        await visit(fullPath);
      } else if (entry.isFile() && entry.name === fileName) {
        results.push(fullPath);
      }
    }
  }

  await visit(root);
  return results;
}

async function findNestedPackArchives(root: string): Promise<string[]> {
  const results: string[] = [];

  async function visit(directory: string) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error("Extracted addon contains a symlink, which is not supported.");
      }

      if (entry.isDirectory()) {
        await visit(fullPath);
      } else if (entry.isFile() && extname(entry.name).toLowerCase() === ".mcpack") {
        results.push(fullPath);
      }
    }
  }

  await visit(root);
  return results;
}

function shouldIgnoreManifestError(manifestPath: string): boolean {
  const normalized = manifestPath.toLowerCase().replace(/\\/g, "/");
  return normalized.includes("/bridge/cache/");
}

function parseVersion(value: unknown): number[] | undefined {
  if (typeof value === "string") {
    const parts = value.split(".");
    if (parts.length !== 3 || !parts.every((part) => /^\d+$/.test(part))) {
      return undefined;
    }

    return parts.map((part) => Number.parseInt(part, 10));
  }

  if (!Array.isArray(value) || value.length !== 3) {
    return undefined;
  }

  if (!value.every((part) => Number.isInteger(part))) {
    return undefined;
  }

  return value as number[];
}

function classifyPackType(manifest: BedrockManifest): InstanceAddonPackType {
  const moduleTypes = manifest.modules?.map((module) => module.type).filter((type): type is string => typeof type === "string") ?? [];
  if (moduleTypes.includes("resources")) {
    return "resource";
  }

  if (moduleTypes.includes("data") || moduleTypes.includes("script")) {
    return "behavior";
  }

  if (moduleTypes.includes("skin_pack")) {
    return "skin";
  }

  return "unknown";
}

function parseDependencyUuids(manifest: BedrockManifest): string[] {
  const uuids = new Set<string>();
  for (const dependency of manifest.dependencies ?? []) {
    if (typeof dependency.uuid === "string" && UUID_PATTERN.test(dependency.uuid)) {
      uuids.add(dependency.uuid);
    }
  }

  return [...uuids];
}

async function parseManifest(manifestPath: string): Promise<DiscoveredAddonPack> {
  const manifestJson = await readFile(manifestPath, "utf8");
  const normalizedManifestJson = stripJsonComments(manifestJson.replace(/^\uFEFF/, ""));
  let persistedManifestJson = normalizedManifestJson;
  let manifest: BedrockManifest;
  try {
    manifest = JSON.parse(normalizedManifestJson) as BedrockManifest;
  } catch (error) {
    const recoveredManifestJson = extractLeadingJsonObject(normalizedManifestJson);
    if (!recoveredManifestJson) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Pack manifest is not valid JSON: ${manifestPath}: ${message}`);
    }

    try {
      manifest = JSON.parse(recoveredManifestJson) as BedrockManifest;
      persistedManifestJson = recoveredManifestJson;
    } catch {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Pack manifest is not valid JSON: ${manifestPath}: ${message}`);
    }
  }
  const headerUuid = typeof manifest.header?.uuid === "string" ? manifest.header.uuid : "";
  const headerVersion = parseVersion(manifest.header?.version);

  if (!UUID_PATTERN.test(headerUuid)) {
    throw new Error(`Pack manifest is missing a valid header.uuid: ${manifestPath}`);
  }

  if (!headerVersion) {
    throw new Error(`Pack manifest is missing a valid three-part header.version array or dotted string: ${manifestPath}`);
  }

  const packType = classifyPackType(manifest);
  const pack: DiscoveredAddonPack = {
    packType,
    status: packType === "unknown" ? "unsupported" : "downloaded",
    headerUuid,
    headerVersion,
    dependencyUuids: parseDependencyUuids(manifest),
    sourcePath: dirname(manifestPath),
    manifestJson: persistedManifestJson,
  };

  if (typeof manifest.header?.name === "string") pack.name = manifest.header.name;
  if (typeof manifest.header?.description === "string") pack.description = manifest.header.description;
  const minEngineVersion = parseVersion(manifest.header?.min_engine_version);
  if (minEngineVersion) pack.minEngineVersion = minEngineVersion;

  return pack;
}

export async function inspectAddonArchive(archivePath: string, extractedPath: string): Promise<DiscoveredAddonPack[]> {
  await rm(extractedPath, { recursive: true, force: true });
  await extractZipArchive(archivePath, extractedPath);

  const nestedArchives = await findNestedPackArchives(extractedPath);
  for (const nestedArchive of nestedArchives) {
    const nestedName = basename(nestedArchive, extname(nestedArchive)).replace(/[^a-zA-Z0-9._-]/g, "_");
    await extractZipArchive(nestedArchive, join(extractedPath, "nested", nestedName));
  }

  const manifestPaths = await findFiles(extractedPath, "manifest.json");
  const packs: DiscoveredAddonPack[] = [];
  const manifestErrors: Error[] = [];
  for (const manifestPath of manifestPaths) {
    const manifestStat = await stat(manifestPath);
    if (!manifestStat.isFile()) {
      continue;
    }

    try {
      packs.push(await parseManifest(manifestPath));
    } catch (error) {
      if (shouldIgnoreManifestError(manifestPath)) {
        continue;
      }

      manifestErrors.push(error instanceof Error ? error : new Error(String(error)));
    }
  }

  if (packs.length === 0 && manifestErrors.length > 0) {
    throw manifestErrors[0];
  }

  return packs;
}
