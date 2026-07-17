import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Database } from "better-sqlite3";
import type { BedrockServerSettings } from "../../shared/types/index.js";
import { getBdsRuntimeState } from "../bds/bdsRuntimeService.js";
import { getInstance } from "./instanceService.js";
import { saveInstanceSettings } from "./instanceSettingsRepository.js";
import { getSettings } from "./instanceSettingsService.js";
import { appendInstanceRuntimeEvent } from "./instanceRuntimeEventService.js";
import { parseServerPropertiesValues, serializeServerProperties } from "./serverProperties.js";

function getServerPropertiesPath(instancePath: string): string {
  return join(instancePath, "bds", "server.properties");
}

function requiresRuntimeRestart(runtime: Awaited<ReturnType<typeof getBdsRuntimeState>>): boolean {
  return runtime.isProcessActive || runtime.desiredStatus === "running";
}

async function readOrCreateServerPropertiesContent(
  db: Database,
  instanceId: string,
): Promise<{ filePath: string; content: string }> {
  const instance = getInstance(db, instanceId);

  if (!instance) {
    throw new Error("Instance not found");
  }

  const filePath = getServerPropertiesPath(instance.instancePath);

  try {
    return {
      filePath,
      content: await readFile(filePath, "utf8"),
    };
  } catch (error) {
    const settings = getSettings(db, instanceId);

    if (!settings) {
      throw error;
    }

    return {
      filePath,
      content: serializeServerProperties(settings),
    };
  }
}

function parseBoolean(value: string, fallback: boolean): boolean {
  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  return fallback;
}

function parseInteger(value: string, fallback: number): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function applyPropertiesToSettings(
  existingSettings: BedrockServerSettings,
  values: Record<string, string>,
): BedrockServerSettings {
  return {
    ...existingSettings,
    serverName: values["server-name"] ?? existingSettings.serverName,
    gamemode: (values.gamemode as BedrockServerSettings["gamemode"] | undefined) ?? existingSettings.gamemode,
    difficulty: (values.difficulty as BedrockServerSettings["difficulty"] | undefined) ?? existingSettings.difficulty,
    allowCheats:
      values["allow-cheats"] !== undefined
        ? parseBoolean(values["allow-cheats"], existingSettings.allowCheats)
        : existingSettings.allowCheats,
    maxPlayers:
      values["max-players"] !== undefined
        ? parseInteger(values["max-players"], existingSettings.maxPlayers)
        : existingSettings.maxPlayers,
    onlineMode:
      values["online-mode"] !== undefined
        ? parseBoolean(values["online-mode"], existingSettings.onlineMode)
        : existingSettings.onlineMode,
    serverPort:
      values["server-port"] !== undefined
        ? parseInteger(values["server-port"], existingSettings.serverPort)
        : existingSettings.serverPort,
    serverPortV6:
      values["server-portv6"] !== undefined
        ? parseInteger(values["server-portv6"], existingSettings.serverPortV6)
        : existingSettings.serverPortV6,
    viewDistance:
      values["view-distance"] !== undefined
        ? parseInteger(values["view-distance"], existingSettings.viewDistance)
        : existingSettings.viewDistance,
    tickDistance:
      values["tick-distance"] !== undefined
        ? parseInteger(values["tick-distance"], existingSettings.tickDistance)
        : existingSettings.tickDistance,
    defaultPlayerPermissionLevel:
      (values["default-player-permission-level"] as BedrockServerSettings["defaultPlayerPermissionLevel"] | undefined) ??
      existingSettings.defaultPlayerPermissionLevel,
    texturepackRequired:
      values["texturepack-required"] !== undefined
        ? parseBoolean(values["texturepack-required"], existingSettings.texturepackRequired)
        : existingSettings.texturepackRequired,
    playerIdleTimeout:
      values["player-idle-timeout"] !== undefined
        ? parseInteger(values["player-idle-timeout"], existingSettings.playerIdleTimeout)
        : existingSettings.playerIdleTimeout,
    updatedAt: new Date().toISOString(),
  };
}

export async function getServerPropertiesEditorPayload(db: Database, instanceId: string): Promise<{
  content: string;
  filePath: string;
  restartRequired: boolean;
}> {
  const { filePath, content } = await readOrCreateServerPropertiesContent(db, instanceId);
  const runtime = await getBdsRuntimeState(db, instanceId);

  return {
    content,
    filePath,
    restartRequired: requiresRuntimeRestart(runtime),
  };
}

export async function saveServerPropertiesFromEditor(
  db: Database,
  instanceId: string,
  content: string,
): Promise<{
  content: string;
  filePath: string;
  restartRequired: boolean;
}> {
  const existingSettings = getSettings(db, instanceId);

  if (!existingSettings) {
    throw new Error("Settings not found");
  }

  const { filePath } = await readOrCreateServerPropertiesContent(db, instanceId);
  const normalizedContent = content.endsWith("\n") ? content : `${content}\n`;
  await writeFile(filePath, normalizedContent, "utf8");

  const nextSettings = applyPropertiesToSettings(existingSettings, parseServerPropertiesValues(normalizedContent));
  saveInstanceSettings(db, nextSettings);

  const runtime = await getBdsRuntimeState(db, instanceId);
  const restartRequired = requiresRuntimeRestart(runtime);

  await appendInstanceRuntimeEvent(db, instanceId, {
    category: "settings",
    action: "server_properties_saved",
    level: restartRequired ? "warning" : "info",
    message: restartRequired
      ? "Saved server.properties. A restart is required for changes to take effect."
      : "Saved server.properties.",
    details: {
      filePath,
      restartRequired,
    },
  });

  return {
    content: normalizedContent,
    filePath,
    restartRequired,
  };
}
