import type { Database } from "better-sqlite3";
import type { FastifyBaseLogger } from "fastify";
import type { Instance, InstanceUpdateCheckWeekday } from "../../shared/types/index.js";
import { discoverBdsDownloadUrl } from "../bds/bdsDiscoveryService.js";
import { getBdsStatusForInstance, installBdsForInstance } from "../bds/bdsInstallService.js";
import { getBdsRuntimeState, sendBdsCommand, setBdsMaintenanceState, startBdsForInstance, stopBdsForInstance } from "../bds/bdsRuntimeService.js";
import { getAppSettings } from "../setup/setupService.js";
import { listInstances } from "./instanceService.js";
import { getInstance, saveInstance, updateInstanceAutoUpdateCheckAt } from "./instanceRepository.js";
import { createInternalRevertBackup, restoreConfigFilesFromInternalBackup } from "./instanceBackupService.js";
import { appendInstanceRuntimeEvent } from "./instanceRuntimeEventService.js";

const AUTO_UPDATE_INTERVAL_MS = 60_000;
const MAINTENANCE_WARNING_DELAY_MS = 10_000;
let schedulerTimer: NodeJS.Timeout | null = null;
const activeUpdates = new Set<string>();

type TimezoneDateParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: InstanceUpdateCheckWeekday;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getTimezoneDateParts(date: Date, timeZone: string): TimezoneDateParts {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });

  const parts = formatter.formatToParts(date);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return {
    year: Number(byType.year),
    month: Number(byType.month),
    day: Number(byType.day),
    hour: Number(byType.hour),
    minute: Number(byType.minute),
    weekday: String(byType.weekday).toLowerCase() as InstanceUpdateCheckWeekday,
  };
}

function toUtcMidnightStamp(parts: Pick<TimezoneDateParts, "year" | "month" | "day">): number {
  return Date.UTC(parts.year, parts.month - 1, parts.day);
}

function hasReachedScheduledTime(parts: TimezoneDateParts, scheduledTime: string): boolean {
  const [scheduledHourText, scheduledMinuteText] = scheduledTime.split(":");
  const scheduledHour = Number(scheduledHourText);
  const scheduledMinute = Number(scheduledMinuteText);

  if (Number.isNaN(scheduledHour) || Number.isNaN(scheduledMinute)) {
    return false;
  }

  if (parts.hour > scheduledHour) {
    return true;
  }

  if (parts.hour === scheduledHour && parts.minute >= scheduledMinute) {
    return true;
  }

  return false;
}

function isInstanceDueForAutoUpdate(instance: Instance, timeZone: string, now: Date): boolean {
  if (!instance.automaticUpdatesEnabled) {
    return false;
  }

  const nowParts = getTimezoneDateParts(now, timeZone);
  if (!hasReachedScheduledTime(nowParts, instance.updateCheckTime)) {
    return false;
  }

  if (!instance.lastAutoUpdateCheckAt) {
    return instance.updateCheckFrequency === "daily" || nowParts.weekday === instance.updateCheckWeekday;
  }

  const lastParts = getTimezoneDateParts(new Date(instance.lastAutoUpdateCheckAt), timeZone);
  const nowDayStamp = toUtcMidnightStamp(nowParts);
  const lastDayStamp = toUtcMidnightStamp(lastParts);

  if (instance.updateCheckFrequency === "daily") {
    return nowDayStamp > lastDayStamp;
  }

  if (nowParts.weekday !== instance.updateCheckWeekday) {
    return false;
  }

  return nowDayStamp > lastDayStamp;
}

async function applyBdsUpdateForInstance(
  db: Database,
  logger: FastifyBaseLogger,
  instance: Instance,
  checkedAt: string,
  options?: { updateLastCheckAt?: boolean },
): Promise<import("../../shared/types/index.js").BdsInstall> {
  const shouldUpdateLastCheckAt = options?.updateLastCheckAt ?? true;

  if (activeUpdates.has(instance.id)) {
    return await getBdsStatusForInstance(db, instance.id);
  }

  activeUpdates.add(instance.id);

  try {
    const discovery = await discoverBdsDownloadUrl();
    if (shouldUpdateLastCheckAt) {
      updateInstanceAutoUpdateCheckAt(db, instance.id, checkedAt);
    }

    await appendInstanceRuntimeEvent(db, instance.id, {
      category: "update",
      action: "update_check_completed",
      level: "info",
      message: discovery.version
        ? `Checked for BDS updates. Latest available version is ${discovery.version}.`
        : "Checked for BDS updates, but the latest version could not be determined.",
      details: {
        latestVersion: discovery.version ?? null,
        currentVersion: instance.bdsVersion,
        source: shouldUpdateLastCheckAt ? "automatic" : "manual",
      },
      createdAt: checkedAt,
    });

    if (!discovery.version || discovery.version === instance.bdsVersion) {
      logger.info({ instanceId: instance.id, version: discovery.version }, "No BDS update needed");
      await appendInstanceRuntimeEvent(db, instance.id, {
        category: "update",
        action: "update_not_needed",
        level: "info",
        message: discovery.version
          ? `No update needed. Instance is already on ${discovery.version}.`
          : "No update was installed because no latest version was available.",
        details: {
          latestVersion: discovery.version ?? null,
          currentVersion: instance.bdsVersion,
          source: shouldUpdateLastCheckAt ? "automatic" : "manual",
        },
        createdAt: checkedAt,
      });
      return await getBdsStatusForInstance(db, instance.id);
    }

    await appendInstanceRuntimeEvent(db, instance.id, {
      category: "update",
      action: "update_started",
      level: "warning",
      message: `Starting BDS update from ${instance.bdsVersion} to ${discovery.version}.`,
      details: {
        currentVersion: instance.bdsVersion,
        targetVersion: discovery.version,
        source: shouldUpdateLastCheckAt ? "automatic" : "manual",
      },
      createdAt: checkedAt,
    });

    const runtimeBeforeUpdate = await getBdsRuntimeState(db, instance.id);
    const wasRunning = runtimeBeforeUpdate.isProcessActive;

    if (wasRunning) {
      await setBdsMaintenanceState(
        db,
        instance.id,
        "update",
        `Preparing BDS update to ${discovery.version}. The instance will shut down for maintenance.`,
      );
      sendBdsCommand(instance.id, "say Server maintenance starting for a Bedrock update. The server will shut down shortly.");
      await sleep(MAINTENANCE_WARNING_DELAY_MS);
      await stopBdsForInstance(db, instance.id);
    }

    await setBdsMaintenanceState(db, instance.id, "backup", "Creating an internal revert backup before updating BDS.");
    const revertBackup = await createInternalRevertBackup(db, instance.id);
    await setBdsMaintenanceState(db, instance.id, "update", `Installing BDS ${discovery.version}.`);
    const install = await installBdsForInstance(db, instance.id);
    await setBdsMaintenanceState(db, instance.id, "restore", "Restoring instance configuration after the BDS update.");
    await restoreConfigFilesFromInternalBackup(db, instance.id, revertBackup.backupId);

    const refreshedInstance = getInstance(db, instance.id);
    if (refreshedInstance && install.version) {
      refreshedInstance.bdsVersion = install.version;
      refreshedInstance.updatedAt = new Date().toISOString();
      saveInstance(db, refreshedInstance);
    }

    if (wasRunning) {
      await setBdsMaintenanceState(db, instance.id, "update", "Restarting the instance after the BDS update.");
      await startBdsForInstance(db, instance.id);
    } else {
      await setBdsMaintenanceState(db, instance.id, "idle", "BDS update completed.");
    }

    logger.info({ instanceId: instance.id, version: install.version }, "Completed BDS update");
    await appendInstanceRuntimeEvent(db, instance.id, {
      category: "update",
      action: "update_completed",
      level: "info",
      message: `Completed BDS update to ${install.version ?? discovery.version}.`,
      details: {
        previousVersion: instance.bdsVersion,
        installedVersion: install.version ?? discovery.version ?? null,
        source: shouldUpdateLastCheckAt ? "automatic" : "manual",
        serverRestarted: wasRunning,
      },
    });
    return install;
  } catch (error) {
    logger.error({ instanceId: instance.id, error }, "BDS update failed");
    const message = error instanceof Error ? error.message : String(error);
    await setBdsMaintenanceState(db, instance.id, "idle", `BDS update failed: ${message}`);
    await appendInstanceRuntimeEvent(db, instance.id, {
      category: "update",
      action: "update_failed",
      level: "error",
      message: `BDS update failed: ${message}`,
      details: {
        currentVersion: instance.bdsVersion,
        source: shouldUpdateLastCheckAt ? "automatic" : "manual",
      },
    });
    throw error;
  } finally {
    const latestRuntimeState = await getBdsRuntimeState(db, instance.id);
    if (!latestRuntimeState.isProcessActive && latestRuntimeState.maintenanceStatus !== "idle") {
      await setBdsMaintenanceState(db, instance.id, "idle");
    }
    activeUpdates.delete(instance.id);
  }
}

async function performAutoUpdateForInstance(db: Database, logger: FastifyBaseLogger, instance: Instance, checkedAt: string): Promise<void> {
  await applyBdsUpdateForInstance(db, logger, instance, checkedAt);
}

export async function runManualUpdateForInstance(
  db: Database,
  logger: FastifyBaseLogger,
  instanceId: string,
): Promise<import("../../shared/types/index.js").BdsInstall> {
  const instance = getInstance(db, instanceId);

  if (!instance) {
    throw new Error("Instance not found");
  }

  return await applyBdsUpdateForInstance(db, logger, instance, new Date().toISOString(), {
    updateLastCheckAt: false,
  });
}

async function runAutoUpdateCycle(db: Database, logger: FastifyBaseLogger): Promise<void> {
  const appSettings = getAppSettings(db);
  const timeZone = appSettings?.timezone ?? "UTC";
  const now = new Date();
  const checkedAt = now.toISOString();

  for (const instance of listInstances(db)) {
    if (!isInstanceDueForAutoUpdate(instance, timeZone, now)) {
      continue;
    }

    await performAutoUpdateForInstance(db, logger, instance, checkedAt);
  }
}

export function startInstanceAutoUpdateScheduler(db: Database, logger: FastifyBaseLogger): void {
  if (schedulerTimer) {
    return;
  }

  void runAutoUpdateCycle(db, logger);

  schedulerTimer = setInterval(() => {
    void runAutoUpdateCycle(db, logger);
  }, AUTO_UPDATE_INTERVAL_MS);
}
