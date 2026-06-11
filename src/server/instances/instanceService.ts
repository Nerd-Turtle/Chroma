import type { Instance } from "../../shared/types/index.js";
import { getRuntimePaths } from "../config/paths.js";
import { createId } from "../utils/createId.js";
import { createInstanceDirectories } from "./instanceFilesystem.js";

export type CreateInstanceInput = {
  friendlyName: string;
  bdsVersion: string;
};

const instances = new Map<string, Instance>();

export function listInstances(): Instance[] {
  return Array.from(instances.values());
}

export function getInstance(instanceId: string): Instance | undefined {
  return instances.get(instanceId);
}

export async function createInstance(input: CreateInstanceInput): Promise<Instance> {
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

  instances.set(id, instance);

  return instance;
}
