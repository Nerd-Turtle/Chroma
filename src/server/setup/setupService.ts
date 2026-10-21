import { isTimeZone } from "../../shared/validation.js";
import { ConflictError, InputValidationError } from "../utils/httpErrors.js";
import type { Database } from "better-sqlite3";
import type { AppSettings, SetupCompleteRequest, UpdateAppSettingsRequest, UserRecord } from "../../shared/types/index.js";
import { createId } from "../utils/createId.js";
import { hashPassword } from "../auth/passwords.js";
import { DEFAULT_SESSION_IDLE_TIMEOUT_MINUTES, getSessionIdleTimeoutMinutes, SESSION_IDLE_TIMEOUT_KEY } from "../auth/sessionPolicy.js";
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

  // Return configuration state/a short hint, never the provider credential itself.
  // https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html
  const curseForgeApiKey = getCurseForgeApiKey(db);

  return {
    timezone,
    language,
    notificationDurationSeconds: getNotificationDurationSeconds(db),
    sessionIdleTimeoutMinutes: getSessionIdleTimeoutMinutes(db),
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
  if (!isTimeZone(input.timezone)) throw new InputValidationError("timezone must be a valid named IANA timezone");
  if (isSetupComplete(db)) {
    throw new ConflictError("Setup is already complete");
  }

  if (getUserByUsername(db, input.username)) {
    throw new ConflictError("Username is already taken");
  }

  // Hash before taking SQLite's write lock; never await inside a synchronous transaction.
  const passwordHash = await hashPassword(input.password);
  // CWE-367: recheck the one-time setup decision while holding the write transaction.
  // BEGIN IMMEDIATE also serializes setup across separate database connections/processes.
  // https://cwe.mitre.org/data/definitions/367.html
  // https://www.sqlite.org/lang_transaction.html#deferred_immediate_and_exclusive_transactions
  db.transaction(() => {
    if (isSetupComplete(db)) throw new ConflictError("Setup is already complete");
    if (getUserByUsername(db, input.username)) throw new ConflictError("Username is already taken");
    const now = new Date().toISOString();
    const user: UserRecord = {
      id: createId("usr"), username: input.username, passwordHash, role: "admin",
      createdAt: now, updatedAt: now,
    };
    insertUser(db, user);
    upsertAppSetting(db, TIMEZONE_KEY, input.timezone, now);
    upsertAppSetting(db, LANGUAGE_KEY, input.language, now);
    upsertAppSetting(db, NOTIFICATION_DURATION_SECONDS_KEY, String(DEFAULT_NOTIFICATION_DURATION_SECONDS), now);
    upsertAppSetting(db, SESSION_IDLE_TIMEOUT_KEY, String(DEFAULT_SESSION_IDLE_TIMEOUT_MINUTES), now);
    const curseForgeApiKey = normalizeOptionalSecret(input.curseForgeApiKey);
    if (curseForgeApiKey) upsertAppSetting(db, CURSEFORGE_API_KEY_KEY, curseForgeApiKey, now);
    upsertAppSetting(db, SETUP_COMPLETE_KEY, "true", now);
  }).immediate();
}

export function updateAppSettings(db: Database, input: UpdateAppSettingsRequest): AppSettings {
  if (!isTimeZone(input.timezone)) throw new InputValidationError("timezone must be a valid named IANA timezone");
  if (input.sessionIdleTimeoutMinutes !== undefined && (!Number.isInteger(input.sessionIdleTimeoutMinutes) ||
    input.sessionIdleTimeoutMinutes < 1 || input.sessionIdleTimeoutMinutes > 120)) {
    throw new InputValidationError("sessionIdleTimeoutMinutes must be an integer between 1 and 120");
  }
  const now = new Date().toISOString();

  upsertAppSetting(db, TIMEZONE_KEY, input.timezone, now);
  upsertAppSetting(db, LANGUAGE_KEY, input.language, now);
  upsertAppSetting(db, NOTIFICATION_DURATION_SECONDS_KEY, String(input.notificationDurationSeconds), now);
  if (input.sessionIdleTimeoutMinutes !== undefined) {
    upsertAppSetting(db, SESSION_IDLE_TIMEOUT_KEY, String(input.sessionIdleTimeoutMinutes), now);
  }

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
