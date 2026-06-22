import type { Database } from "better-sqlite3";
import type { AppSettings, DashboardSummary, SetupCompleteRequest, UpdateAppSettingsRequest, UserRecord } from "../../shared/types/index.js";
import { createId } from "../utils/createId.js";
import { listInstances } from "../instances/instanceService.js";
import { hashPassword } from "../auth/passwords.js";
import { getUserByUsername, insertUser } from "../auth/userRepository.js";
import { deleteAppSetting, getAppSetting, upsertAppSetting } from "./appSettingsRepository.js";

const SETUP_COMPLETE_KEY = "setup.complete";
const TIMEZONE_KEY = "app.timezone";
const LANGUAGE_KEY = "app.language";
const CURSEFORGE_API_KEY_KEY = "providers.curseforge.api_key";

function normalizeOptionalSecret(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function getLastFour(value: string): string {
  return value.slice(Math.max(0, value.length - 4));
}

export function isSetupComplete(db: Database): boolean {
  return getAppSetting(db, SETUP_COMPLETE_KEY) === "true";
}

export function getAppSettings(db: Database): AppSettings | undefined {
  const timezone = getAppSetting(db, TIMEZONE_KEY);
  const language = getAppSetting(db, LANGUAGE_KEY);
  if (!timezone || !language) {
    return undefined;
  }

  const curseForgeApiKey = getCurseForgeApiKey(db);

  return {
    timezone,
    language,
    curseForgeApiKeyConfigured: Boolean(curseForgeApiKey),
    ...(curseForgeApiKey ? { curseForgeApiKeyLastFour: getLastFour(curseForgeApiKey) } : {}),
  };
}

export function getCurseForgeApiKey(db: Database): string | undefined {
  return normalizeOptionalSecret(getAppSetting(db, CURSEFORGE_API_KEY_KEY));
}

export async function completeInitialSetup(db: Database, input: SetupCompleteRequest): Promise<void> {
  if (isSetupComplete(db)) {
    throw new Error("Setup is already complete");
  }

  if (getUserByUsername(db, input.username)) {
    throw new Error("Username is already taken");
  }

  const now = new Date().toISOString();
  const user: UserRecord = {
    id: createId("usr"),
    username: input.username,
    passwordHash: await hashPassword(input.password),
    role: "admin",
    createdAt: now,
    updatedAt: now,
  };

  insertUser(db, user);
  upsertAppSetting(db, TIMEZONE_KEY, input.timezone, now);
  upsertAppSetting(db, LANGUAGE_KEY, input.language, now);
  const curseForgeApiKey = normalizeOptionalSecret(input.curseForgeApiKey);
  if (curseForgeApiKey) {
    upsertAppSetting(db, CURSEFORGE_API_KEY_KEY, curseForgeApiKey, now);
  }
  upsertAppSetting(db, SETUP_COMPLETE_KEY, "true", now);
}

export function updateAppSettings(db: Database, input: UpdateAppSettingsRequest): AppSettings {
  const now = new Date().toISOString();

  upsertAppSetting(db, TIMEZONE_KEY, input.timezone, now);
  upsertAppSetting(db, LANGUAGE_KEY, input.language, now);

  if (input.clearCurseForgeApiKey) {
    deleteAppSetting(db, CURSEFORGE_API_KEY_KEY);
  } else {
    const curseForgeApiKey = normalizeOptionalSecret(input.curseForgeApiKey);
    if (curseForgeApiKey) {
      upsertAppSetting(db, CURSEFORGE_API_KEY_KEY, curseForgeApiKey, now);
    }
  }

  const settings = getAppSettings(db);
  if (!settings) {
    throw new Error("Application settings could not be loaded after update");
  }

  return settings;
}

export function getDashboardSummary(db: Database): DashboardSummary {
  const instances = listInstances(db);
  const runningInstanceCount = instances.filter((instance) => instance.status === "running").length;
  const stoppedInstanceCount = instances.filter((instance) => instance.status === "stopped").length;
  const appSettings = getAppSettings(db);

  return {
    instanceCount: instances.length,
    runningInstanceCount,
    stoppedInstanceCount,
    ...(appSettings ? { appSettings } : {}),
  };
}
