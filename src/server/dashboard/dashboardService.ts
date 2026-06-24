import { readFile } from "node:fs/promises";
import os from "node:os";
import type { Database } from "better-sqlite3";
import type {
  DashboardHealthSummary,
  DashboardInstanceHealthCategory,
  DashboardInstancePerformance,
  DashboardSummary,
} from "../../shared/types/index.js";
import { listInstances } from "../instances/instanceService.js";
import { getBdsRuntimeState } from "../bds/bdsRuntimeService.js";
import { getAppSettings } from "../setup/setupService.js";

type SystemCpuSample = {
  idleJiffies: number;
  totalJiffies: number;
};

type ProcessCpuSample = {
  processJiffies: number;
  totalJiffies: number;
};

const previousProcessCpuSamples = new Map<string, ProcessCpuSample>();
let previousSystemCpuSample: SystemCpuSample | undefined;

void primeSystemCpuSample();

async function primeSystemCpuSample(): Promise<void> {
  try {
    previousSystemCpuSample = await readSystemCpuSample();
  } catch {
    previousSystemCpuSample = undefined;
  }
}

async function readSystemCpuSample(): Promise<SystemCpuSample> {
  const stat = await readFile("/proc/stat", "utf8");
  const cpuLine = stat.split("\n").find((line) => line.startsWith("cpu "));

  if (!cpuLine) {
    throw new Error("Unable to read system CPU statistics.");
  }

  const fields = cpuLine
    .trim()
    .split(/\s+/)
    .slice(1)
    .map((value) => Number.parseInt(value, 10))
    .filter((value) => Number.isFinite(value));

  const idleJiffies = (fields[3] ?? 0) + (fields[4] ?? 0);
  const totalJiffies = fields.reduce((sum, value) => sum + value, 0);

  return {
    idleJiffies,
    totalJiffies,
  };
}

function calculateSystemCpuUsagePercent(currentSample: SystemCpuSample): number {
  const previousSample = previousSystemCpuSample;
  previousSystemCpuSample = currentSample;

  if (!previousSample) {
    return 0;
  }

  const idleDelta = currentSample.idleJiffies - previousSample.idleJiffies;
  const totalDelta = currentSample.totalJiffies - previousSample.totalJiffies;

  if (totalDelta <= 0) {
    return 0;
  }

  const usagePercent = ((totalDelta - idleDelta) / totalDelta) * 100;
  return clampPercent(usagePercent);
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Number.parseFloat(value.toFixed(1))));
}

async function readProcessCpuJiffies(pid: number): Promise<number | undefined> {
  try {
    const stat = await readFile(`/proc/${pid}/stat`, "utf8");
    const lastClosingParenIndex = stat.lastIndexOf(")");

    if (lastClosingParenIndex === -1) {
      return undefined;
    }

    const fields = stat
      .slice(lastClosingParenIndex + 1)
      .trim()
      .split(/\s+/);
    const userJiffies = Number.parseInt(fields[11] ?? "", 10);
    const kernelJiffies = Number.parseInt(fields[12] ?? "", 10);

    if (!Number.isFinite(userJiffies) || !Number.isFinite(kernelJiffies)) {
      return undefined;
    }

    return userJiffies + kernelJiffies;
  } catch {
    return undefined;
  }
}

async function readProcessRamUsageBytes(pid: number): Promise<number | undefined> {
  try {
    const status = await readFile(`/proc/${pid}/status`, "utf8");
    const rssLine = status.split("\n").find((line) => line.startsWith("VmRSS:"));

    if (!rssLine) {
      return undefined;
    }

    const kilobytes = Number.parseInt(rssLine.trim().split(/\s+/)[1] ?? "", 10);
    if (!Number.isFinite(kilobytes)) {
      return undefined;
    }

    return kilobytes * 1024;
  } catch {
    return undefined;
  }
}

async function readInstanceResourceUsage(
  instanceId: string,
  pid: number | undefined,
  systemCpuSample: SystemCpuSample,
): Promise<Pick<DashboardInstancePerformance, "cpuUsagePercent" | "ramUsageBytes">> {
  if (!pid) {
    previousProcessCpuSamples.delete(instanceId);
    return {};
  }

  const [processJiffies, ramUsageBytes] = await Promise.all([
    readProcessCpuJiffies(pid),
    readProcessRamUsageBytes(pid),
  ]);

  if (processJiffies === undefined) {
    previousProcessCpuSamples.delete(instanceId);
    return {
      ...(ramUsageBytes !== undefined ? { ramUsageBytes } : {}),
    };
  }

  const currentSample: ProcessCpuSample = {
    processJiffies,
    totalJiffies: systemCpuSample.totalJiffies,
  };
  const previousSample = previousProcessCpuSamples.get(instanceId);
  previousProcessCpuSamples.set(instanceId, currentSample);

  if (!previousSample) {
    return {
      ...(ramUsageBytes !== undefined ? { ramUsageBytes } : {}),
    };
  }

  const processDelta = currentSample.processJiffies - previousSample.processJiffies;
  const totalDelta = currentSample.totalJiffies - previousSample.totalJiffies;

  if (processDelta <= 0 || totalDelta <= 0) {
    return {
      ...(ramUsageBytes !== undefined ? { ramUsageBytes } : {}),
    };
  }

  return {
    cpuUsagePercent: clampPercent((processDelta / totalDelta) * 100),
    ...(ramUsageBytes !== undefined ? { ramUsageBytes } : {}),
  };
}

function getInstanceHealthCategory(
  status: DashboardInstancePerformance["status"],
  runtimeStatus: DashboardInstancePerformance["runtimeStatus"],
  runtimeHealthStatus: DashboardInstancePerformance["runtimeHealthStatus"],
): DashboardInstanceHealthCategory {
  if (status === "stopped" || runtimeStatus === "stopped") {
    return "stopped";
  }

  if (runtimeStatus === "running" && runtimeHealthStatus === "healthy") {
    return "healthy";
  }

  return "error";
}

function buildInstanceHealthSummary(instancePerformance: DashboardInstancePerformance[]): DashboardHealthSummary {
  const healthyCount = instancePerformance.filter((instance) => instance.healthCategory === "healthy").length;
  const errorCount = instancePerformance.filter((instance) => instance.healthCategory === "error").length;
  const stoppedCount = instancePerformance.filter((instance) => instance.healthCategory === "stopped").length;

  return {
    healthyCount,
    errorCount,
    stoppedCount,
    segments: instancePerformance.map((instance) => ({
      instanceId: instance.instanceId,
      friendlyName: instance.friendlyName,
      healthCategory: instance.healthCategory,
    })),
  };
}

export async function getDashboardSummary(db: Database): Promise<DashboardSummary> {
  const [instances, systemCpuSample] = await Promise.all([
    Promise.resolve(listInstances(db)),
    readSystemCpuSample(),
  ]);
  const runtimeStates = await Promise.all(
    instances.map(async (instance) => {
      const runtime = await getBdsRuntimeState(db, instance.id);
      return [instance.id, runtime] as const;
    }),
  );
  const runtimeStateByInstanceId = new Map(runtimeStates);
  const activeInstanceIds = new Set<string>();

  const instancePerformance = await Promise.all(
    instances.map(async (instance) => {
      const runtime = runtimeStateByInstanceId.get(instance.id);
      const runtimeStatus = runtime?.status ?? "unknown";
      const runtimeHealthStatus = runtime?.healthStatus ?? "unknown";
      const isProcessActive = runtime?.isProcessActive ?? false;
      const pid = isProcessActive ? runtime?.pid : undefined;

      if (pid !== undefined) {
        activeInstanceIds.add(instance.id);
      }

      const resourceUsage = await readInstanceResourceUsage(instance.id, pid, systemCpuSample);
      const healthCategory = getInstanceHealthCategory(instance.status, runtimeStatus, runtimeHealthStatus);

      return {
        instanceId: instance.id,
        friendlyName: instance.friendlyName,
        status: instance.status,
        healthCategory,
        runtimeStatus,
        runtimeHealthStatus,
        isProcessActive,
        ...(pid !== undefined ? { pid } : {}),
        ...resourceUsage,
      } satisfies DashboardInstancePerformance;
    }),
  );

  for (const instanceId of previousProcessCpuSamples.keys()) {
    if (!activeInstanceIds.has(instanceId)) {
      previousProcessCpuSamples.delete(instanceId);
    }
  }

  const instanceHealth = buildInstanceHealthSummary(instancePerformance);
  const runningInstanceCount = instances.filter((instance) => instance.status === "running").length;
  const stoppedInstanceCount = instances.filter((instance) => instance.status === "stopped").length;
  const ramTotalBytes = os.totalmem();
  const ramUsageBytes = ramTotalBytes - os.freemem();
  const appSettings = getAppSettings(db);

  return {
    instanceCount: instances.length,
    runningInstanceCount,
    stoppedInstanceCount,
    systemPerformance: {
      cpuUsagePercent: calculateSystemCpuUsagePercent(systemCpuSample),
      ramUsageBytes,
      ramTotalBytes,
      ramUsagePercent: clampPercent((ramUsageBytes / ramTotalBytes) * 100),
    },
    instancePerformance,
    instanceHealth,
    ...(appSettings ? { appSettings } : {}),
  };
}
