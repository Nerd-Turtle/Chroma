import type { Database } from "better-sqlite3";
import type { FastifyBaseLogger } from "fastify";
import type { Instance, InstanceUpdateCheckWeekday } from "../../shared/types/index.js";
import { discoverBdsDownloadUrl } from "../bds/bdsDiscoveryService.js";
import { installBdsForInstance } from "../bds/bdsInstallService.js";
import { getBdsRuntimeState, sendBdsCommand, startBdsForInstance, stopBdsForInstance } from "../bds/bdsRuntimeService.js";
import { getAppSettings } from "../setup/setupService.js";
import { listInstances } from "./instanceService.js";
import { getInstance, saveInstance, updateInstanceAutoUpdateCheckAt } from "./instanceRepository.js";
import { createInternalRevertBackup, restoreConfigFilesFromInternalBackup } from "./instanceBackupService.js";

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

async function performAutoUpdateForInstance(db: Database, logger: FastifyBaseLogger, instance: Instance, checkedAt: string): Promise<void> {
  if (activeUpdates.has(instance.id)) {
    return;
  }

  activeUpdates.add(instance.id);

  try {
    const discovery = await discoverBdsDownloadUrl();
    updateInstanceAutoUpdateCheckAt(db, instance.id, checkedAt);

    if (!discovery.version || discovery.version === instance.bdsVersion) {
      logger.info({ instanceId: instance.id, version: discovery.version }, "No BDS auto-update needed");
      return;
    }

    const runtimeBeforeUpdate = await getBdsRuntimeState(db, instance.id);
    const wasRunning = runtimeBeforeUpdate.status === "running";

    if (wasRunning) {
      sendBdsCommand(instance.id, "say Server maintenance starting for a Bedrock update. The server will shut down shortly.");
      await sleep(MAINTENANCE_WARNING_DELAY_MS);
      await stopBdsForInstance(db, instance.id);
    }

    const revertBackup = await createInternalRevertBackup(db, instance.id);
    const install = await installBdsForInstance(db, instance.id);
    await restoreConfigFilesFromInternalBackup(db, instance.id, revertBackup.backupId);

    const refreshedInstance = getInstance(db, instance.id);
    if (refreshedInstance && install.version) {
      refreshedInstance.bdsVersion = install.version;
      refreshedInstance.updatedAt = new Date().toISOString();
      saveInstance(db, refreshedInstance);
    }

    if (wasRunning) {
      await startBdsForInstance(db, instance.id);
    }

    logger.info({ instanceId: instance.id, version: install.version }, "Completed BDS auto-update");
  } catch (error) {
    logger.error({ instanceId: instance.id, error }, "BDS auto-update failed");
  } finally {
    activeUpdates.delete(instance.id);
  }
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
