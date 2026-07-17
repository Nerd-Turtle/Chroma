import type { Database } from "better-sqlite3";
import type { FastifyBaseLogger } from "fastify";
import type { BdsConsoleSnapshot } from "../../shared/types/index.js";
import type { BdsRuntimeState } from "../../shared/types/bdsRuntime.js";
import type { Instance } from "../../shared/types/index.js";
import type { BdsStartValidationIssue, BdsStartValidationResult } from "../../shared/types/index.js";
import { applyEnabledAddonsForInstance } from "../addons/addonApplicationService.js";
import { getInstance, listInstances } from "../instances/instanceService.js";
import { getBdsInstall } from "./bdsRepository.js";
import { updateInstanceStatus } from "../instances/instanceRepository.js";
import { BdsProcessManager } from "./bdsProcessManager.js";
import { BdsStartValidationError, validateInstanceCanStart } from "./bdsStartValidationService.js";
import { appendInstanceRuntimeEvent } from "../instances/instanceRuntimeEventService.js";
import type { BdsLogFileSummary, BdsLogPage, BdsLogTail } from "./bdsLogService.js";
import { getInstanceBdsLogPage, getInstanceCurrentBdsLogTail, listBdsLogFiles } from "./bdsLogService.js";

const processManager = new BdsProcessManager();
let runtimeStateSynchronizationInitialized = false;

type StartBdsForInstanceOptions = {
  onValidationResult?: (result: BdsStartValidationResult) => void;
};

const repairableAddonStartIssueCodes = new Set([
  "enabled_addon_world_missing",
  "enabled_addon_pack_missing_path",
  "enabled_addon_pack_missing",
  "enabled_addon_pack_unreferenced",
]);

export class BdsStartupVerificationError extends Error {
  readonly runtime: BdsRuntimeState;

  constructor(runtime: BdsRuntimeState) {
    super(runtime.message ?? "BDS failed startup verification.");
    this.name = "BdsStartupVerificationError";
    this.runtime = runtime;
  }
}

function mapRuntimeStateToInstanceStatus(runtimeState: BdsRuntimeState): Instance["status"] {
  if (runtimeState.maintenanceStatus === "update") {
    return "updating";
  }

  if (runtimeState.maintenanceStatus === "backup") {
    return "backing_up";
  }

  if (runtimeState.maintenanceStatus === "restore") {
    return "restoring";
  }

  if (runtimeState.status === "unknown") {
    return "unknown";
  }

  if (runtimeState.healthStatus === "degraded") {
    return "degraded";
  }

  return runtimeState.status as Instance["status"];
}

function hasRepairableAddonStartIssues(result: BdsStartValidationResult): boolean {
  return result.errors.some((issue) => repairableAddonStartIssueCodes.has(issue.code));
}

function buildAddonRepairWarning(repairedAddonCount: number, repairedPackCount: number, reasons: string[]): BdsStartValidationIssue {
  const reasonText = reasons.length > 0 ? ` ${reasons.join("; ")}.` : "";
  return {
    code: "enabled_addons_repaired",
    level: "warning",
    field: "addons",
    message:
      `Chroma repaired enabled addon files for ${repairedAddonCount} addon${repairedAddonCount === 1 ? "" : "s"} ` +
      `and ${repairedPackCount} pack${repairedPackCount === 1 ? "" : "s"} before starting the server.${reasonText}`,
  };
}

async function validateAndRepairInstanceForStart(db: Database, instance: Instance): Promise<BdsStartValidationResult> {
  const initialResult = await validateInstanceCanStart(db, instance);

  if (!hasRepairableAddonStartIssues(initialResult)) {
    return initialResult;
  }

  try {
    const repairResult = await applyEnabledAddonsForInstance(db, instance, { createBackup: true });
    const repairedResult = await validateInstanceCanStart(db, instance);

    if (!repairResult.repaired) {
      return repairedResult;
    }

    const repairWarning = buildAddonRepairWarning(repairResult.addonCount, repairResult.packCount, repairResult.reasons);

    await appendInstanceRuntimeEvent(db, instance.id, {
      category: "runtime",
      action: "start_addons_repaired",
      level: "warning",
      message: repairWarning.message,
      details: {
        addonCount: repairResult.addonCount,
        packCount: repairResult.packCount,
        reasons: repairResult.reasons,
      },
    });

    return {
      canStart: repairedResult.canStart,
      errors: repairedResult.errors,
      warnings: [repairWarning, ...repairedResult.warnings],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    return {
      canStart: false,
      errors: [
        ...initialResult.errors.filter((issue) => !repairableAddonStartIssueCodes.has(issue.code)),
        {
          code: "enabled_addon_repair_failed",
          level: "error",
          field: "addons",
          message: `Chroma could not repair enabled addons before start: ${message}`,
        },
      ],
      warnings: initialResult.warnings,
    };
  }
}

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

  const runtimeState = processManager.getRuntimeState(instanceId);
  if (processManager.hasRuntimeState(instanceId)) {
    const nextStatus = mapRuntimeStateToInstanceStatus(runtimeState);
    if (instance.status !== nextStatus) {
      updateInstanceStatus(db, instanceId, nextStatus);
    }

    return runtimeState;
  }

  if (instance.status === "running" || instance.status === "starting" || instance.status === "stopping") {
    return {
      ...runtimeState,
      status: "unknown",
      desiredStatus: instance.status === "stopping" ? "stopped" : "running",
      healthStatus: "unknown",
      maintenanceStatus: "idle",
      message: "No in-memory runtime state is available for an instance previously marked active.",
    };
  }

  return runtimeState;
}

export function initializeBdsRuntimeStateSynchronization(db: Database, logger: FastifyBaseLogger): void {
  if (runtimeStateSynchronizationInitialized) {
    return;
  }

  runtimeStateSynchronizationInitialized = true;
  processManager.subscribeToRuntimeState((runtimeState) => {
    const instance = getInstance(db, runtimeState.instanceId);
    if (!instance) {
      return;
    }

    const nextStatus = mapRuntimeStateToInstanceStatus(runtimeState);
    if (instance.status === nextStatus) {
      return;
    }

    try {
      updateInstanceStatus(db, runtimeState.instanceId, nextStatus);
    } catch (error) {
      logger.error(
        {
          instanceId: runtimeState.instanceId,
          runtimeStatus: runtimeState.status,
          desiredStatus: runtimeState.desiredStatus,
          healthStatus: runtimeState.healthStatus,
          error: error instanceof Error ? error.message : String(error),
        },
        "Failed to synchronize persisted BDS runtime state",
      );
    }
  });
}

export async function setBdsMaintenanceState(
  db: Database,
  instanceId: string,
  maintenanceStatus: BdsRuntimeState["maintenanceStatus"],
  message?: string,
): Promise<BdsRuntimeState> {
  const instance = getInstance(db, instanceId);

  if (!instance) {
    throw new Error("Instance not found");
  }

  const runtimeState = processManager.setMaintenanceState(instanceId, maintenanceStatus, message);
  await updateInstanceStatus(db, instanceId, mapRuntimeStateToInstanceStatus(runtimeState));
  return runtimeState;
}

export async function startBdsForInstance(
  db: Database,
  instanceId: string,
  options: StartBdsForInstanceOptions = {},
): Promise<BdsRuntimeState> {
  const instance = getInstance(db, instanceId);

  if (!instance) {
    throw new Error("Instance not found");
  }

  ensureBdsInstalled(db, instanceId);
  await appendInstanceRuntimeEvent(db, instanceId, {
    category: "runtime",
    action: "start_requested",
    level: "info",
    message: "Start requested for the instance.",
  });

  try {
    const validationResult = await validateAndRepairInstanceForStart(db, instance);
    options.onValidationResult?.(validationResult);
    if (!validationResult.canStart) {
      throw new BdsStartValidationError(validationResult);
    }
  } catch (error) {
    if (error instanceof Error) {
      await appendInstanceRuntimeEvent(db, instanceId, {
        category: "runtime",
        action: "start_blocked",
        level: "warning",
        message: error.message,
      });
    }

    throw error;
  }

  await updateInstanceStatus(db, instanceId, "starting");

  try {
    const runtimeState = await processManager.start(instance);
    const nextInstanceStatus = mapRuntimeStateToInstanceStatus(runtimeState);
    await updateInstanceStatus(db, instanceId, nextInstanceStatus);

    if (runtimeState.status !== "running") {
      await appendInstanceRuntimeEvent(db, instanceId, {
        category: "runtime",
        action: "start_failed",
        level: "error",
        message: runtimeState.message ?? "BDS failed startup verification.",
        details: {
          runtimeStatus: runtimeState.status,
          healthStatus: runtimeState.healthStatus,
          pid: runtimeState.pid ?? null,
        },
      });
      throw new BdsStartupVerificationError(runtimeState);
    }

    await appendInstanceRuntimeEvent(db, instanceId, {
      category: "runtime",
      action: "start_verified",
      level: runtimeState.healthStatus === "degraded" ? "warning" : "info",
      message: runtimeState.message ?? "BDS startup verified.",
      details: {
        runtimeStatus: runtimeState.status,
        healthStatus: runtimeState.healthStatus,
        pid: runtimeState.pid ?? null,
      },
    });

    return runtimeState;
  } catch (error) {
    if (error instanceof BdsStartupVerificationError) {
      throw error;
    }

    await updateInstanceStatus(db, instanceId, "error");
    const message = error instanceof Error ? error.message : String(error);
    await appendInstanceRuntimeEvent(db, instanceId, {
      category: "runtime",
      action: "start_failed",
      level: "error",
      message: `Failed to start BDS: ${message}`,
    });
    throw new Error(message);
  }
}

export async function stopBdsForInstance(db: Database, instanceId: string): Promise<BdsRuntimeState> {
  const instance = getInstance(db, instanceId);

  if (!instance) {
    throw new Error("Instance not found");
  }

  await appendInstanceRuntimeEvent(db, instanceId, {
    category: "runtime",
    action: "stop_requested",
    level: "info",
    message: "Stop requested for the instance.",
  });

  const runtimeState = await processManager.stop(instanceId);
  await updateInstanceStatus(db, instanceId, mapRuntimeStateToInstanceStatus(runtimeState));

  await appendInstanceRuntimeEvent(db, instanceId, {
    category: "runtime",
    action: runtimeState.status === "stopped" ? "stop_completed" : "stop_failed",
    level: runtimeState.status === "stopped" ? "info" : "error",
    message: runtimeState.message ?? (runtimeState.status === "stopped" ? "Instance stopped." : "Instance stop failed."),
    details: {
      runtimeStatus: runtimeState.status,
      healthStatus: runtimeState.healthStatus,
      pid: runtimeState.pid ?? null,
    },
  });

  return runtimeState;
}

export async function restartBdsForInstance(db: Database, instanceId: string): Promise<BdsRuntimeState> {
  const instance = getInstance(db, instanceId);

  if (!instance) {
    throw new Error("Instance not found");
  }

  await appendInstanceRuntimeEvent(db, instanceId, {
    category: "runtime",
    action: "restart_requested",
    level: "info",
    message: "Restart requested for the instance.",
  });

  await stopBdsForInstance(db, instanceId);
  const runtimeState = await startBdsForInstance(db, instanceId);

  await appendInstanceRuntimeEvent(db, instanceId, {
    category: "runtime",
    action: "restart_completed",
    level: runtimeState.healthStatus === "degraded" ? "warning" : "info",
    message: "Restart completed for the instance.",
    details: {
      runtimeStatus: runtimeState.status,
      healthStatus: runtimeState.healthStatus,
      pid: runtimeState.pid ?? null,
    },
  });

  return runtimeState;
}

export function sendBdsCommand(instanceId: string, command: string): boolean {
  return processManager.sendCommand(instanceId, command);
}

export function getBdsPlayerCount(instanceId: string): number | undefined {
  return processManager.getPlayerCount(instanceId);
}

export async function getBdsConsoleSnapshot(db: Database, instanceId: string): Promise<BdsConsoleSnapshot> {
  const instance = getInstance(db, instanceId);

  if (!instance) {
    throw new Error("Instance not found");
  }

  return processManager.getConsoleSnapshot(instanceId);
}

export function subscribeToBdsConsole(
  instanceId: string,
  listener: Parameters<BdsProcessManager["subscribeToConsole"]>[1],
): () => void {
  return processManager.subscribeToConsole(instanceId, listener);
}

export async function listBdsLogFilesForInstance(db: Database, instanceId: string): Promise<BdsLogFileSummary[]> {
  return await listBdsLogFiles(db, instanceId);
}

export async function getBdsCurrentLogTailForInstance(db: Database, instanceId: string, limit: number): Promise<BdsLogTail> {
  return await getInstanceCurrentBdsLogTail(db, instanceId, limit);
}

export async function getBdsLogPageForInstance(
  db: Database,
  instanceId: string,
  fileName: string,
  offset: number,
  limit: number,
): Promise<BdsLogPage> {
  return await getInstanceBdsLogPage(db, instanceId, fileName, offset, limit);
}

export async function sendBdsConsoleCommand(
  db: Database,
  instanceId: string,
  command: string,
): Promise<{ accepted: true } | { accepted: false; error: string; runtime: BdsRuntimeState }> {
  const instance = getInstance(db, instanceId);

  if (!instance) {
    throw new Error("Instance not found");
  }

  const runtime = await getBdsRuntimeState(db, instanceId);
  if (!runtime.isProcessActive || runtime.status !== "running") {
    return {
      accepted: false,
      error: "Console commands are only available while the instance is running.",
      runtime,
    };
  }

  if (!processManager.sendCommand(instanceId, command)) {
    return {
      accepted: false,
      error:
        runtime.healthStatus === "degraded"
          ? "Live console control is unavailable until the instance is restarted under direct Chroma management."
          : "The live console command channel is unavailable right now.",
      runtime,
    };
  }

  return { accepted: true };
}

export async function stopAllBdsProcesses(): Promise<void> {
  await processManager.stopAll();
}

export async function reconcileBdsRuntimeStates(db: Database, logger: FastifyBaseLogger): Promise<void> {
  for (const instance of listInstances(db)) {
    const runtimeState = await processManager.reconcile(instance);
    const nextInstanceStatus = mapRuntimeStateToInstanceStatus(runtimeState);
    updateInstanceStatus(db, instance.id, nextInstanceStatus);

    if (runtimeState.isProcessActive || runtimeState.status === "unknown") {
      await appendInstanceRuntimeEvent(db, instance.id, {
        category: "runtime",
        action: "reconciled",
        level: runtimeState.healthStatus === "degraded" || runtimeState.healthStatus === "unhealthy" ? "warning" : "info",
        message: runtimeState.message ?? "Reconciled runtime state during Chroma startup.",
        details: {
          runtimeStatus: runtimeState.status,
          desiredStatus: runtimeState.desiredStatus,
          healthStatus: runtimeState.healthStatus,
          pid: runtimeState.pid ?? null,
          isProcessActive: runtimeState.isProcessActive,
        },
      });
    }

    logger.info(
      {
        instanceId: instance.id,
        runtimeStatus: runtimeState.status,
        desiredStatus: runtimeState.desiredStatus,
        healthStatus: runtimeState.healthStatus,
        isProcessActive: runtimeState.isProcessActive,
        pid: runtimeState.pid,
      },
      "Reconciled BDS runtime state for instance",
    );
  }
}
