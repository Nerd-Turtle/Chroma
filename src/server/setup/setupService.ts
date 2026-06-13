import type { Database } from "better-sqlite3";
import type { AppSettings, DashboardSummary, SetupCompleteRequest, UserRecord } from "../../shared/types/index.js";
import { createId } from "../utils/createId.js";
import { listInstances } from "../instances/instanceService.js";
import { hashPassword } from "../auth/passwords.js";
import { getUserByUsername, insertUser } from "../auth/userRepository.js";
import { getAppSetting, upsertAppSetting } from "./appSettingsRepository.js";

const SETUP_COMPLETE_KEY = "setup.complete";
const TIMEZONE_KEY = "app.timezone";
const LANGUAGE_KEY = "app.language";

export function isSetupComplete(db: Database): boolean {
  return getAppSetting(db, SETUP_COMPLETE_KEY) === "true";
}

export function getAppSettings(db: Database): AppSettings | undefined {
  const timezone = getAppSetting(db, TIMEZONE_KEY);
  const language = getAppSetting(db, LANGUAGE_KEY);
  if (!timezone || !language) {
    return undefined;
  }

  return { timezone, language };
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
  upsertAppSetting(db, SETUP_COMPLETE_KEY, "true", now);
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
