import type { Database } from "better-sqlite3";
import type { AddonUpdateSettings } from "../../shared/types/index.js";
import { getAppSetting, upsertAppSetting } from "../setup/appSettingsRepository.js";

const ADDON_UPDATE_CHECKS_ENABLED_KEY = "addons.updates.automatic_checks_enabled";
const ADDON_UPDATE_CHECK_FREQUENCY_KEY = "addons.updates.check_frequency";
const ADDON_UPDATE_CHECK_TIME_KEY = "addons.updates.check_time";
const ADDON_UPDATE_CHECK_WEEKDAY_KEY = "addons.updates.check_weekday";
const ADDON_RELEASE_CHANNEL_KEY = "addons.updates.release_channel";

const DEFAULT_ADDON_UPDATE_SETTINGS: AddonUpdateSettings = {
  automaticChecksEnabled: true,
  releaseChannel: "stable",
  updateCheckFrequency: "daily",
  updateCheckTime: "03:00",
  updateCheckWeekday: "sunday",
};

export function getAddonUpdateSettings(db: Database): AddonUpdateSettings {
  const automaticChecksEnabled = getAppSetting(db, ADDON_UPDATE_CHECKS_ENABLED_KEY);
  const updateCheckFrequency = getAppSetting(db, ADDON_UPDATE_CHECK_FREQUENCY_KEY);
  const updateCheckTime = getAppSetting(db, ADDON_UPDATE_CHECK_TIME_KEY);
  const updateCheckWeekday = getAppSetting(db, ADDON_UPDATE_CHECK_WEEKDAY_KEY);
  const releaseChannel = getAppSetting(db, ADDON_RELEASE_CHANNEL_KEY);

  return {
    releaseChannel: releaseChannel === "beta" || releaseChannel === "alpha" ? releaseChannel : "stable",
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
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(input.updateCheckTime)) throw new Error("Choose an update time between 00:00 and 23:59.");
  if (!["stable", "beta", "alpha"].includes(input.releaseChannel)) throw new Error("Choose stable, beta or alpha addon releases.");
  const now = new Date().toISOString();

  upsertAppSetting(db, ADDON_UPDATE_CHECKS_ENABLED_KEY, input.automaticChecksEnabled ? "true" : "false", now);
  upsertAppSetting(db, ADDON_UPDATE_CHECK_FREQUENCY_KEY, input.updateCheckFrequency, now);
  upsertAppSetting(db, ADDON_UPDATE_CHECK_TIME_KEY, input.updateCheckTime, now);
  upsertAppSetting(db, ADDON_UPDATE_CHECK_WEEKDAY_KEY, input.updateCheckWeekday, now);
  upsertAppSetting(db, ADDON_RELEASE_CHANNEL_KEY, input.releaseChannel, now);

  return getAddonUpdateSettings(db);
}
