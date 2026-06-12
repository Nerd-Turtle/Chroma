import type { Database } from "better-sqlite3";
import type { BedrockServerSettings } from "../../shared/types/serverSettings.js";
import { getInstance } from "./instanceService.js";
import { getInstanceSettings, saveInstanceSettings } from "./instanceSettingsRepository.js";
import { writeServerProperties } from "./serverProperties.js";
import { getDefaultBedrockServerSettings } from "./serverSettingsDefaults.js";

export function getSettings(db: Database, instanceId: string): BedrockServerSettings | undefined {
  return getInstanceSettings(db, instanceId);
}

export async function createDefaultSettingsForInstance(db: Database, instanceId: string): Promise<BedrockServerSettings> {
  const instance = getInstance(db, instanceId);
  if (!instance) throw new Error("Instance not found");

  const defaults = getDefaultBedrockServerSettings(instanceId, instance.friendlyName);
  saveInstanceSettings(db, defaults);
  await writeServerProperties(instance.instancePath, defaults);
  return defaults;
}

export async function saveSettingsAndRender(db: Database, settings: BedrockServerSettings): Promise<void> {
  saveInstanceSettings(db, settings);
  const instance = getInstance(db, settings.instanceId);
  if (!instance) throw new Error("Instance not found");
  await writeServerProperties(instance.instancePath, settings);
}
