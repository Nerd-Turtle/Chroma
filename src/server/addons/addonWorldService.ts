import { mkdir, opendir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { Instance, InstanceAddonPack } from "../../shared/types/index.js";
import { readServerPropertiesLevelName } from "../instances/serverProperties.js";

export type WorldPackReference = {
  pack_id: string;
  version: number[];
};

function assertChildPath(parentPath: string, childPath: string): void {
  const relativePath = relative(resolve(parentPath), resolve(childPath));
  if (relativePath === "" || relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new Error("Resolved world path is outside the expected instance directory.");
  }
}

async function pathIsDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function listWorldDirectories(worldsPath: string): Promise<string[]> {
  const worldDirectories: string[] = [];
  const directory = await opendir(worldsPath);

  for await (const entry of directory) {
    if (entry.isDirectory()) {
      worldDirectories.push(entry.name);
    }
  }

  return worldDirectories;
}

export async function findExistingActiveWorldPath(instance: Instance): Promise<string | undefined> {
  const worldsPath = join(instance.instancePath, "bds", "worlds");

  if (instance.activeWorldName) {
    const worldPath = join(worldsPath, instance.activeWorldName);
    assertChildPath(worldsPath, worldPath);
    return (await pathIsDirectory(worldPath)) ? worldPath : undefined;
  }

  const worldDirectories = await listWorldDirectories(worldsPath);

  if (worldDirectories.length === 1) {
    const [worldDirectory] = worldDirectories;
    if (worldDirectory) {
      return join(worldsPath, worldDirectory);
    }
  }

  if (worldDirectories.includes("Bedrock level")) {
    return join(worldsPath, "Bedrock level");
  }

  return undefined;
}

export async function ensureActiveWorldPath(instance: Instance): Promise<string> {
  const existingWorldPath = await findExistingActiveWorldPath(instance);
  if (existingWorldPath) {
    return existingWorldPath;
  }

  const worldsPath = join(instance.instancePath, "bds", "worlds");
  const worldName = instance.activeWorldName ?? await readServerPropertiesLevelName(instance.instancePath);
  const worldPath = join(worldsPath, worldName);
  assertChildPath(worldsPath, worldPath);
  await mkdir(worldPath, { recursive: true });
  return worldPath;
}

export async function readWorldPackReferences(path: string): Promise<WorldPackReference[]> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
    if (!Array.isArray(parsed)) {
      throw new Error(`World pack file is not an array: ${path}`);
    }

    return parsed.filter((entry): entry is WorldPackReference => {
      if (!entry || typeof entry !== "object") return false;
      const maybeReference = entry as Partial<WorldPackReference>;
      return typeof maybeReference.pack_id === "string" && Array.isArray(maybeReference.version);
    });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

export async function writeWorldPackReferences(path: string, references: WorldPackReference[]): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(references, null, 2)}\n`, "utf8");
}

export function addWorldPackReference(references: WorldPackReference[], pack: InstanceAddonPack): WorldPackReference[] {
  const exists = references.some(
    (reference) => reference.pack_id === pack.headerUuid && JSON.stringify(reference.version) === JSON.stringify(pack.headerVersion),
  );

  if (exists) {
    return references;
  }

  return [...references, { pack_id: pack.headerUuid, version: pack.headerVersion }];
}

export function removeWorldPackReference(references: WorldPackReference[], pack: InstanceAddonPack): WorldPackReference[] {
  return references.filter(
    (reference) => !(reference.pack_id === pack.headerUuid && JSON.stringify(reference.version) === JSON.stringify(pack.headerVersion)),
  );
}

export function sameWorldPackReference(reference: WorldPackReference, pack: InstanceAddonPack): boolean {
  return reference.pack_id === pack.headerUuid && JSON.stringify(reference.version) === JSON.stringify(pack.headerVersion);
}

export function applyManagedPackOrder(references: WorldPackReference[], orderedPacks: InstanceAddonPack[]): WorldPackReference[] {
  const unmanagedReferences = references.filter(
    (reference) => !orderedPacks.some((pack) => sameWorldPackReference(reference, pack)),
  );

  return [
    ...orderedPacks.map((pack) => ({
      pack_id: pack.headerUuid,
      version: pack.headerVersion,
    })),
    ...unmanagedReferences,
  ];
}
