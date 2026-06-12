import type { Database } from "better-sqlite3";
import type { Instance } from "../../shared/types/index.js";
import { getRuntimePaths } from "../config/paths.js";
import { createId } from "../utils/createId.js";
import { createInstanceDirectories } from "./instanceFilesystem.js";
import {
  getInstance as getInstanceFromDb,
  listInstances as listInstancesFromDb,
  saveInstance as saveInstanceToDb,
} from "./instanceRepository.js";
import { createDefaultSettingsForInstance } from "./instanceSettingsService.js";

export type CreateInstanceInput = {
  friendlyName: string;
  bdsVersion: string;
};

export function listInstances(db: Database): Instance[] {
  return listInstancesFromDb(db);
}

export function getInstance(db: Database, instanceId: string): Instance | undefined {
  return getInstanceFromDb(db, instanceId);
}

export async function createInstance(
  db: Database,
  input: CreateInstanceInput,
): Promise<Instance> {
  const now = new Date().toISOString();
  const id = createId("inst");
  const runtimePaths = getRuntimePaths();

  const instance: Instance = {
    id,
    friendlyName: input.friendlyName,
    status: "stopped",
    bdsVersion: input.bdsVersion,
    instancePath: `${runtimePaths.dataDir}/instances/${id}`,
    createdAt: now,
    updatedAt: now,
  };

  await createInstanceDirectories(instance);
  saveInstanceToDb(db, instance);

  // Create default server settings and render server.properties
  try {
    await createDefaultSettingsForInstance(db, id);
  } catch (error) {
    // Do not fail instance creation if settings writing fails; log to console
    // The server will still report the instance but settings can be retried.
    // Avoid throwing raw errors to clients.
    // eslint-disable-next-line no-console
    console.error("Failed to create default settings for instance", { instanceId: id, error });
  }

  return instance;
}
