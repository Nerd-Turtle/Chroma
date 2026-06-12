import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { BedrockServerSettings } from "../../shared/types/serverSettings.js";

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
