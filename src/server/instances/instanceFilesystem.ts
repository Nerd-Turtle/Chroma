import { mkdir } from "node:fs/promises";
import type { Instance } from "../../shared/types/index.js";

export async function createInstanceDirectories(instance: Instance): Promise<void> {
  const directories = [
    instance.instancePath,
    `${instance.instancePath}/bds`,
    `${instance.instancePath}/bds/worlds`,
    `${instance.instancePath}/bds/behavior_packs`,
    `${instance.instancePath}/bds/resource_packs`,
    `${instance.instancePath}/csm`,
    `${instance.instancePath}/csm/addons`,
    `${instance.instancePath}/csm/backups`,
    `${instance.instancePath}/csm/events`,
    `${instance.instancePath}/csm/logs`,
    `${instance.instancePath}/csm/jobs`,
  ];

  for (const directory of directories) {
    await mkdir(directory, { recursive: true });
  }
}
