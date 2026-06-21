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
import { installBdsForInstance } from "../bds/bdsInstallService.js";
import { appendInstanceRuntimeEvent } from "./instanceRuntimeEventService.js";

export type CreateInstanceInput = {
  friendlyName: string;
  bdsVersion: string;
  automaticUpdatesEnabled: boolean;
  updateCheckFrequency: Instance["updateCheckFrequency"];
  updateCheckTime: string;
  updateCheckWeekday: Instance["updateCheckWeekday"];
};

export type UpdateInstanceInput = {
  friendlyName: string;
  automaticUpdatesEnabled: boolean;
  updateCheckFrequency: Instance["updateCheckFrequency"];
  updateCheckTime: string;
  updateCheckWeekday: Instance["updateCheckWeekday"];
};

export function listInstances(db: Database): Instance[] {
  return listInstancesFromDb(db);
}

export function getInstance(db: Database, instanceId: string): Instance | undefined {
  return getInstanceFromDb(db, instanceId);
}

export function updateInstance(
  db: Database,
  instanceId: string,
  input: UpdateInstanceInput,
): Promise<Instance | undefined> {
  const instance = getInstanceFromDb(db, instanceId);

  if (!instance) {
    return Promise.resolve(undefined);
  }

  instance.friendlyName = input.friendlyName;
  instance.automaticUpdatesEnabled = input.automaticUpdatesEnabled;
  instance.updateCheckFrequency = input.updateCheckFrequency;
  instance.updateCheckTime = input.updateCheckTime;
  instance.updateCheckWeekday = input.updateCheckWeekday;
  instance.updatedAt = new Date().toISOString();

  saveInstanceToDb(db, instance);
  return appendInstanceRuntimeEvent(db, instanceId, {
    category: "settings",
    action: "instance_overview_updated",
    level: "info",
    message: "Updated instance overview settings.",
    details: {
      friendlyName: instance.friendlyName,
      automaticUpdatesEnabled: instance.automaticUpdatesEnabled,
      updateCheckFrequency: instance.updateCheckFrequency,
      updateCheckTime: instance.updateCheckTime,
      updateCheckWeekday: instance.updateCheckWeekday,
    },
  }).then(() => instance);
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
    automaticUpdatesEnabled: input.automaticUpdatesEnabled,
    updateCheckFrequency: input.updateCheckFrequency,
    updateCheckTime: input.updateCheckTime,
    updateCheckWeekday: input.updateCheckWeekday,
    instancePath: `${runtimePaths.dataDir}/instances/${id}`,
    lastCheckAt: now,
    lastCheckResult: "Success",
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

  // Automatically install the latest BDS build for a newly created instance,
  // but do not start the server process as part of creation.
  try {
    const install = await installBdsForInstance(db, id);

    if (install.version && install.version !== instance.bdsVersion) {
      instance.bdsVersion = install.version;
      instance.updatedAt = new Date().toISOString();
      saveInstanceToDb(db, instance);
    }
  } catch (error) {
    // Do not fail instance creation if BDS installation fails.
    // The install error is persisted by the BDS install service and can be
    // surfaced to the UI for retry or troubleshooting.
    // eslint-disable-next-line no-console
    console.error("Failed to auto-install BDS for instance", { instanceId: id, error });
  }

  await appendInstanceRuntimeEvent(db, id, {
    category: "settings",
    action: "instance_created",
    level: "info",
    message: "Created a new instance.",
    details: {
      friendlyName: instance.friendlyName,
      installedVersion: instance.bdsVersion,
      automaticUpdatesEnabled: instance.automaticUpdatesEnabled,
    },
  });

  return instance;
}
