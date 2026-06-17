import type { Database } from "better-sqlite3";
import type { BdsRuntimeState } from "../../shared/types/bdsRuntime.js";
import type { Instance } from "../../shared/types/index.js";
import { getInstance } from "../instances/instanceService.js";
import { getBdsInstall } from "./bdsRepository.js";
import { updateInstanceStatus } from "../instances/instanceRepository.js";
import { BdsProcessManager } from "./bdsProcessManager.js";

const processManager = new BdsProcessManager();

function ensureBdsInstalled(db: Database, instanceId: string): void {
  const install = getBdsInstall(db, instanceId);

  if (!install || install.status !== "installed") {
    throw new Error("BDS is not installed for this instance.");
  }
}

export async function getBdsRuntimeState(db: Database, instanceId: string): Promise<BdsRuntimeState> {
  const instance = getInstance(db, instanceId);

  if (!instance) {
    throw new Error("Instance not found");
  }

  return processManager.getRuntimeState(instanceId);
}

export async function startBdsForInstance(db: Database, instanceId: string): Promise<BdsRuntimeState> {
  const instance = getInstance(db, instanceId);

  if (!instance) {
    throw new Error("Instance not found");
  }

  ensureBdsInstalled(db, instanceId);

  try {
    const runtimeState = await processManager.start(instance);
    await updateInstanceStatus(db, instanceId, "running");
    return runtimeState;
  } catch (error) {
    await updateInstanceStatus(db, instanceId, "error");
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(message);
  }
}

export async function stopBdsForInstance(db: Database, instanceId: string): Promise<BdsRuntimeState> {
  const instance = getInstance(db, instanceId);

  if (!instance) {
    throw new Error("Instance not found");
  }

  const runtimeState = await processManager.stop(instanceId);

  if (runtimeState.status === "stopped") {
    await updateInstanceStatus(db, instanceId, "stopped");
  } else if (runtimeState.status === "error") {
    await updateInstanceStatus(db, instanceId, "error");
  }

  return runtimeState;
}

export async function restartBdsForInstance(db: Database, instanceId: string): Promise<BdsRuntimeState> {
  const instance = getInstance(db, instanceId);

  if (!instance) {
    throw new Error("Instance not found");
  }

  await stopBdsForInstance(db, instanceId);
  const runtimeState = await startBdsForInstance(db, instanceId);
  return runtimeState;
}

export function sendBdsCommand(instanceId: string, command: string): boolean {
  return processManager.sendCommand(instanceId, command);
}

export async function stopAllBdsProcesses(): Promise<void> {
  await processManager.stopAll();
}
