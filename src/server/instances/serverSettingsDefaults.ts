import type { BedrockServerSettings } from "../../shared/types/serverSettings.js";

export function getDefaultBedrockServerSettings(instanceId: string, friendlyName: string): BedrockServerSettings {
  const now = new Date().toISOString();

  return {
    instanceId,
    serverName: friendlyName,
    gamemode: "survival",
    difficulty: "normal",
    allowCheats: false,
    maxPlayers: 10,
    onlineMode: true,
    serverPort: 19132,
    serverPortV6: 19133,
    viewDistance: 32,
    tickDistance: 4,
    defaultPlayerPermissionLevel: "member",
    texturepackRequired: false,
    playerIdleTimeout: 30,
    createdAt: now,
    updatedAt: now,
  };
}
