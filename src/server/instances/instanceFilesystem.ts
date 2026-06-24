import { mkdir, rm } from "node:fs/promises";
import { normalize, sep } from "node:path";
import type { Instance } from "../../shared/types/index.js";
import { getRuntimePaths } from "../config/paths.js";

export async function createInstanceDirectories(instance: Instance): Promise<void> {
  const directories = [
    instance.instancePath,
    `${instance.instancePath}/bds`,
    `${instance.instancePath}/bds/worlds`,
    `${instance.instancePath}/bds/behavior_packs`,
    `${instance.instancePath}/bds/resource_packs`,
    `${instance.instancePath}/csm`,
    `${instance.instancePath}/csm/backups`,
    `${instance.instancePath}/csm/events`,
    `${instance.instancePath}/csm/logs`,
    `${instance.instancePath}/csm/jobs`,
  ];

  for (const directory of directories) {
    await mkdir(directory, { recursive: true });
  }
}

export async function deleteInstanceDirectory(instance: Instance): Promise<void> {
  const runtimePaths = getRuntimePaths();
  const instancesRoot = normalize(`${runtimePaths.dataDir}/instances`);
  const instancePath = normalize(instance.instancePath);

  if (!instancePath.startsWith(`${instancesRoot}${sep}`)) {
    throw new Error("Instance path is outside the managed instances directory.");
  }

  await rm(instancePath, { recursive: true, force: true });
}
