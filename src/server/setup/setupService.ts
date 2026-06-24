import type { Database } from "better-sqlite3";
import type { AppSettings, SetupCompleteRequest, UpdateAppSettingsRequest, UserRecord } from "../../shared/types/index.js";
import { createId } from "../utils/createId.js";
import { hashPassword } from "../auth/passwords.js";
import { getUserByUsername, insertUser } from "../auth/userRepository.js";
import { deleteAppSetting, getAppSetting, upsertAppSetting } from "./appSettingsRepository.js";

const SETUP_COMPLETE_KEY = "setup.complete";
const TIMEZONE_KEY = "app.timezone";
const LANGUAGE_KEY = "app.language";
const NOTIFICATION_DURATION_SECONDS_KEY = "app.notification_duration_seconds";
const CURSEFORGE_API_KEY_KEY = "providers.curseforge.api_key";
const DEFAULT_NOTIFICATION_DURATION_SECONDS = 2;

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
    notificationDurationSeconds: getNotificationDurationSeconds(db),
    curseForgeApiKeyConfigured: Boolean(curseForgeApiKey),
    ...(curseForgeApiKey ? { curseForgeApiKeyLastFour: getLastFour(curseForgeApiKey) } : {}),
  };
}

function getNotificationDurationSeconds(db: Database): number {
  const rawValue = getAppSetting(db, NOTIFICATION_DURATION_SECONDS_KEY);
  const parsedValue = rawValue ? Number.parseInt(rawValue, 10) : Number.NaN;

  if (!Number.isInteger(parsedValue) || parsedValue < 1 || parsedValue > 30) {
    return DEFAULT_NOTIFICATION_DURATION_SECONDS;
  }

  return parsedValue;
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
  upsertAppSetting(db, NOTIFICATION_DURATION_SECONDS_KEY, String(DEFAULT_NOTIFICATION_DURATION_SECONDS), now);
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
  upsertAppSetting(db, NOTIFICATION_DURATION_SECONDS_KEY, String(input.notificationDurationSeconds), now);

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
