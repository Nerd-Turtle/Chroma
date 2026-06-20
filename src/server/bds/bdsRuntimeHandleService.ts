import { readFile, rm, writeFile } from "node:fs/promises";
import { join, normalize } from "node:path";
import type { Instance } from "../../shared/types/index.js";

export type PersistedRuntimeHandle = {
  instanceId: string;
  pid: number;
  startedAt?: string;
  observedAt: string;
};

function getRuntimeHandlePath(instance: Instance): string {
  return join(instance.instancePath, "csm", "runtime-process.json");
}

export async function writeRuntimeHandle(instance: Instance, handle: PersistedRuntimeHandle): Promise<void> {
  await writeFile(getRuntimeHandlePath(instance), `${JSON.stringify(handle, null, 2)}\n`, "utf8");
}

export async function readRuntimeHandle(instance: Instance): Promise<PersistedRuntimeHandle | undefined> {
  try {
    const content = await readFile(getRuntimeHandlePath(instance), "utf8");
    return JSON.parse(content) as PersistedRuntimeHandle;
  } catch {
    return undefined;
  }
}

export async function removeRuntimeHandle(instance: Instance): Promise<void> {
  await rm(getRuntimeHandlePath(instance), { force: true });
}

export async function inspectRediscoverableProcess(
  pid: number,
  expectedWorkingDirectory: string,
): Promise<{ exists: boolean; matchesExpectedInstance: boolean }> {
  try {
    process.kill(pid, 0);
  } catch {
    return {
      exists: false,
      matchesExpectedInstance: false,
    };
  }

  try {
    const cwd = await import("node:fs/promises").then((fs) => fs.readlink(`/proc/${pid}/cwd`));
    const normalizedExpected = normalize(expectedWorkingDirectory);
    const normalizedCwd = normalize(cwd);

    return {
      exists: true,
      matchesExpectedInstance: normalizedCwd === normalizedExpected,
    };
  } catch {
    return {
      exists: true,
      matchesExpectedInstance: false,
    };
  }
}
