export type BedrockGameMode = "survival" | "creative" | "adventure";

export type BedrockDifficulty = "peaceful" | "easy" | "normal" | "hard";

export type BedrockPermissionLevel = "visitor" | "member" | "operator";

export type BedrockServerSettings = {
  instanceId: string;
  serverName: string;
  gamemode: BedrockGameMode;
  difficulty: BedrockDifficulty;
  allowCheats: boolean;
  maxPlayers: number;
  onlineMode: boolean;
  serverPort: number;
  serverPortV6: number;
  viewDistance: number;
  tickDistance: number;
  defaultPlayerPermissionLevel: BedrockPermissionLevel;
  texturepackRequired: boolean;
  playerIdleTimeout: number;
  createdAt: string;
  updatedAt: string;
};
