import type { Database } from "better-sqlite3";
import { getAppSetting } from "../setup/appSettingsRepository.js";

export const SESSION_IDLE_TIMEOUT_KEY = "auth.session_idle_timeout_minutes";
export const DEFAULT_SESSION_IDLE_TIMEOUT_MINUTES = 10;

export function getSessionIdleTimeoutMinutes(db: Database): number {
  const value = Number(getAppSetting(db, SESSION_IDLE_TIMEOUT_KEY));
  return Number.isInteger(value) && value >= 1 && value <= 120 ? value : DEFAULT_SESSION_IDLE_TIMEOUT_MINUTES;
}
