import type { Database } from "better-sqlite3";
import type { AddonUpdateSettings } from "../../shared/types/index.js";
import { getAppSetting, upsertAppSetting } from "../setup/appSettingsRepository.js";

const ADDON_UPDATE_CHECKS_ENABLED_KEY = "addons.updates.automatic_checks_enabled";
const ADDON_UPDATE_CHECK_FREQUENCY_KEY = "addons.updates.check_frequency";
const ADDON_UPDATE_CHECK_TIME_KEY = "addons.updates.check_time";
const ADDON_UPDATE_CHECK_WEEKDAY_KEY = "addons.updates.check_weekday";

const DEFAULT_ADDON_UPDATE_SETTINGS: AddonUpdateSettings = {
  automaticChecksEnabled: true,
  updateCheckFrequency: "daily",
  updateCheckTime: "03:00",
  updateCheckWeekday: "sunday",
};

export function getAddonUpdateSettings(db: Database): AddonUpdateSettings {
  const automaticChecksEnabled = getAppSetting(db, ADDON_UPDATE_CHECKS_ENABLED_KEY);
  const updateCheckFrequency = getAppSetting(db, ADDON_UPDATE_CHECK_FREQUENCY_KEY);
  const updateCheckTime = getAppSetting(db, ADDON_UPDATE_CHECK_TIME_KEY);
  const updateCheckWeekday = getAppSetting(db, ADDON_UPDATE_CHECK_WEEKDAY_KEY);

  return {
    automaticChecksEnabled:
      automaticChecksEnabled === undefined
        ? DEFAULT_ADDON_UPDATE_SETTINGS.automaticChecksEnabled
        : automaticChecksEnabled === "true",
    updateCheckFrequency:
      updateCheckFrequency === "weekly" || updateCheckFrequency === "daily"
        ? updateCheckFrequency
        : DEFAULT_ADDON_UPDATE_SETTINGS.updateCheckFrequency,
    updateCheckTime:
      typeof updateCheckTime === "string" && updateCheckTime !== ""
        ? updateCheckTime
        : DEFAULT_ADDON_UPDATE_SETTINGS.updateCheckTime,
    updateCheckWeekday:
      updateCheckWeekday === "monday" ||
      updateCheckWeekday === "tuesday" ||
      updateCheckWeekday === "wednesday" ||
      updateCheckWeekday === "thursday" ||
      updateCheckWeekday === "friday" ||
      updateCheckWeekday === "saturday" ||
      updateCheckWeekday === "sunday"
        ? updateCheckWeekday
        : DEFAULT_ADDON_UPDATE_SETTINGS.updateCheckWeekday,
  };
}

export function saveAddonUpdateSettings(db: Database, input: AddonUpdateSettings): AddonUpdateSettings {
  const now = new Date().toISOString();

  upsertAppSetting(db, ADDON_UPDATE_CHECKS_ENABLED_KEY, input.automaticChecksEnabled ? "true" : "false", now);
  upsertAppSetting(db, ADDON_UPDATE_CHECK_FREQUENCY_KEY, input.updateCheckFrequency, now);
  upsertAppSetting(db, ADDON_UPDATE_CHECK_TIME_KEY, input.updateCheckTime, now);
  upsertAppSetting(db, ADDON_UPDATE_CHECK_WEEKDAY_KEY, input.updateCheckWeekday, now);

  return getAddonUpdateSettings(db);
}
