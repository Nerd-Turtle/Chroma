import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { BedrockServerSettings } from "../../shared/types/serverSettings.js";

const DEFAULT_LEVEL_NAME = "Bedrock level";

export function parseServerPropertiesValues(content: string): Record<string, string> {
  const values: Record<string, string> = {};

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (line === "" || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");

    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();

    if (key !== "") {
      values[key] = value;
    }
  }

  return values;
}

export function getLevelNameFromServerProperties(content: string): string {
  return parseServerPropertiesValues(content)["level-name"]?.trim() || DEFAULT_LEVEL_NAME;
}

export async function readServerPropertiesLevelName(instancePath: string): Promise<string> {
  const serverPropertiesPath = join(instancePath, "bds", "server.properties");
  return getLevelNameFromServerProperties(await readFile(serverPropertiesPath, "utf8"));
}

export function serializeServerProperties(settings: BedrockServerSettings): string {
  const lines: string[] = [];

  lines.push(`server-name=${settings.serverName}`);
  lines.push(`gamemode=${settings.gamemode}`);
  lines.push(`difficulty=${settings.difficulty}`);
  lines.push(`allow-cheats=${settings.allowCheats ? "true" : "false"}`);
  lines.push(`max-players=${settings.maxPlayers}`);
  lines.push(`online-mode=${settings.onlineMode ? "true" : "false"}`);
  lines.push(`server-port=${settings.serverPort}`);
  lines.push(`server-portv6=${settings.serverPortV6}`);
  lines.push(`view-distance=${settings.viewDistance}`);
  lines.push(`tick-distance=${settings.tickDistance}`);
  lines.push(`default-player-permission-level=${settings.defaultPlayerPermissionLevel}`);
  lines.push(`texturepack-required=${settings.texturepackRequired ? "true" : "false"}`);
  lines.push(`player-idle-timeout=${settings.playerIdleTimeout}`);

  return lines.join("\n") + "\n";
}

export async function writeServerProperties(instancePath: string, settings: BedrockServerSettings): Promise<void> {
  const bdsDir = join(instancePath, "bds");
  await mkdir(bdsDir, { recursive: true });
  const outPath = join(bdsDir, "server.properties");
  const contents = serializeServerProperties(settings);
  await writeFile(outPath, contents, { encoding: "utf8" });
}
