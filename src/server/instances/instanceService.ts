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

  return instance;
}
