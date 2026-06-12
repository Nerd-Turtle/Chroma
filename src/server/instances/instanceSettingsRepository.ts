import type { Database } from "better-sqlite3";
import type { BedrockServerSettings } from "../../shared/types/serverSettings.js";

type SettingsRow = {
  instance_id: string;
  server_name: string;
  gamemode: string;
  difficulty: string;
  allow_cheats: number;
  max_players: number;
  online_mode: number;
  server_port: number;
  server_port_v6: number;
  view_distance: number;
  tick_distance: number;
  default_player_permission_level: string;
  texturepack_required: number;
  player_idle_timeout: number;
  created_at: string;
  updated_at: string;
};

function mapRowToSettings(row: SettingsRow): BedrockServerSettings {
  return {
    instanceId: row.instance_id,
    serverName: row.server_name,
    gamemode: row.gamemode as BedrockServerSettings["gamemode"],
    difficulty: row.difficulty as BedrockServerSettings["difficulty"],
    allowCheats: row.allow_cheats === 1,
    maxPlayers: row.max_players,
    onlineMode: row.online_mode === 1,
    serverPort: row.server_port,
    serverPortV6: row.server_port_v6,
    viewDistance: row.view_distance,
    tickDistance: row.tick_distance,
    defaultPlayerPermissionLevel: row.default_player_permission_level as BedrockServerSettings["defaultPlayerPermissionLevel"],
    texturepackRequired: row.texturepack_required === 1,
    playerIdleTimeout: row.player_idle_timeout,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getInstanceSettings(db: Database, instanceId: string): BedrockServerSettings | undefined {
  const row = db.prepare(`SELECT * FROM instance_server_settings WHERE instance_id = ?`).get([instanceId]) as SettingsRow | undefined;
  if (!row) return undefined;
  return mapRowToSettings(row);
}

export function saveInstanceSettings(db: Database, settings: BedrockServerSettings): void {
  const stmt = db.prepare(`INSERT INTO instance_server_settings (
    instance_id,
    server_name,
    gamemode,
    difficulty,
    allow_cheats,
    max_players,
    online_mode,
    server_port,
    server_port_v6,
    view_distance,
    tick_distance,
    default_player_permission_level,
    texturepack_required,
    player_idle_timeout,
    created_at,
    updated_at
  ) VALUES (
    @instance_id,
    @server_name,
    @gamemode,
    @difficulty,
    @allow_cheats,
    @max_players,
    @online_mode,
    @server_port,
    @server_port_v6,
    @view_distance,
    @tick_distance,
    @default_player_permission_level,
    @texturepack_required,
    @player_idle_timeout,
    @created_at,
    @updated_at
  )
  ON CONFLICT(instance_id) DO UPDATE SET
    server_name = excluded.server_name,
    gamemode = excluded.gamemode,
    difficulty = excluded.difficulty,
    allow_cheats = excluded.allow_cheats,
    max_players = excluded.max_players,
    online_mode = excluded.online_mode,
    server_port = excluded.server_port,
    server_port_v6 = excluded.server_port_v6,
    view_distance = excluded.view_distance,
    tick_distance = excluded.tick_distance,
    default_player_permission_level = excluded.default_player_permission_level,
    texturepack_required = excluded.texturepack_required,
    player_idle_timeout = excluded.player_idle_timeout,
    updated_at = excluded.updated_at;
  `);

  stmt.run({
    instance_id: settings.instanceId,
    server_name: settings.serverName,
    gamemode: settings.gamemode,
    difficulty: settings.difficulty,
    allow_cheats: settings.allowCheats ? 1 : 0,
    max_players: settings.maxPlayers,
    online_mode: settings.onlineMode ? 1 : 0,
    server_port: settings.serverPort,
    server_port_v6: settings.serverPortV6,
    view_distance: settings.viewDistance,
    tick_distance: settings.tickDistance,
    default_player_permission_level: settings.defaultPlayerPermissionLevel,
    texturepack_required: settings.texturepackRequired ? 1 : 0,
    player_idle_timeout: settings.playerIdleTimeout,
    created_at: settings.createdAt,
    updated_at: settings.updatedAt,
  });
}
