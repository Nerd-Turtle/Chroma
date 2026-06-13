import type { Database } from "better-sqlite3";
import { createId } from "../utils/createId.js";
import { createUser, getUserByUsername } from "../auth/userRepository.js";
import { getAppSetting, saveAppSetting } from "./appSettingsRepository.js";
import { hashPassword } from "../auth/authService.js";
import type { User } from "../../shared/types/auth.js";

const SETUP_COMPLETED_KEY = "setup.completed";
const TIMEZONE_KEY = "app.timezone";
const LANGUAGE_KEY = "app.language";

export function isSetupComplete(db: Database): boolean {
  return getAppSetting(db, SETUP_COMPLETED_KEY) === "true";
}

export function getAppTimezone(db: Database): string | undefined {
  return getAppSetting(db, TIMEZONE_KEY);
}

export function getAppLanguage(db: Database): string | undefined {
  return getAppSetting(db, LANGUAGE_KEY);
}

export async function completeInitialSetup(
  db: Database,
  username: string,
  password: string,
  timezone: string,
  language: string,
): Promise<void> {
  if (isSetupComplete(db)) {
    throw new Error("Setup has already been completed");
  }

  if (getUserByUsername(db, username)) {
    throw new Error("Username is already taken");
  }

  const now = new Date().toISOString();
  const user: User = {
    id: createId("usr"),
    username,
    passwordHash: await hashPassword(password),
    role: "admin",
    createdAt: now,
    updatedAt: now,
  };

  createUser(db, user);
  saveAppSetting(db, SETUP_COMPLETED_KEY, "true");
  saveAppSetting(db, TIMEZONE_KEY, timezone);
  saveAppSetting(db, LANGUAGE_KEY, language);
}
