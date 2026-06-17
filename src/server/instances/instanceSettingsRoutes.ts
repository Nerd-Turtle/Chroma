import type { FastifyInstance } from "fastify";
import type { Database } from "better-sqlite3";
import type { BedrockServerSettings, UpdateInstanceServerPropertiesRequest } from "../../shared/types/index.js";
import { getSettings, saveSettingsAndRender } from "./instanceSettingsService.js";
import { getInstance } from "./instanceService.js";
import { getServerPropertiesEditorPayload, saveServerPropertiesFromEditor } from "./serverPropertiesEditorService.js";

function isValidPort(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 65535;
}

export function registerInstanceSettingsRoutes(app: FastifyInstance, db: Database) {
  app.get("/api/instances/:instanceId/settings", async (request, reply) => {
    const params = request.params as { instanceId: string };
    const instance = getInstance(db, params.instanceId);
    if (!instance) return reply.code(404).send({ error: "Instance not found" });

    const settings = getSettings(db, params.instanceId);
    if (!settings) return reply.code(404).send({ error: "Settings not found" });

    return { settings };
  });

  app.put("/api/instances/:instanceId/settings", async (request, reply) => {
    const params = request.params as { instanceId: string };
    const body = request.body as Record<string, unknown>;

    const instance = getInstance(db, params.instanceId);
    if (!instance) return reply.code(404).send({ error: "Instance not found" });

    const existing = getSettings(db, params.instanceId);
    if (!existing) return reply.code(404).send({ error: "Settings not found" });

    const updates: Partial<BedrockServerSettings> = {};

    if (body.serverName !== undefined) {
      if (typeof body.serverName !== "string" || body.serverName.trim() === "") return reply.code(400).send({ error: "serverName is required" });
      updates.serverName = body.serverName.trim();
    }

    if (body.gamemode !== undefined) {
      if (!["survival", "creative", "adventure"].includes(String(body.gamemode))) return reply.code(400).send({ error: "invalid gamemode" });
      updates.gamemode = String(body.gamemode) as BedrockServerSettings["gamemode"];
    }

    if (body.difficulty !== undefined) {
      if (!["peaceful", "easy", "normal", "hard"].includes(String(body.difficulty))) return reply.code(400).send({ error: "invalid difficulty" });
      updates.difficulty = String(body.difficulty) as BedrockServerSettings["difficulty"];
    }

    if (body.defaultPlayerPermissionLevel !== undefined) {
      if (!["visitor", "member", "operator"].includes(String(body.defaultPlayerPermissionLevel))) return reply.code(400).send({ error: "invalid defaultPlayerPermissionLevel" });
      updates.defaultPlayerPermissionLevel = String(body.defaultPlayerPermissionLevel) as BedrockServerSettings["defaultPlayerPermissionLevel"];
    }

    if (body.maxPlayers !== undefined) {
      if (typeof body.maxPlayers !== "number" || !Number.isInteger(body.maxPlayers) || body.maxPlayers < 1 || body.maxPlayers > 100) return reply.code(400).send({ error: "invalid maxPlayers" });
      updates.maxPlayers = body.maxPlayers;
    }

    if (body.serverPort !== undefined) {
      if (!isValidPort(body.serverPort)) return reply.code(400).send({ error: "invalid serverPort" });
      updates.serverPort = body.serverPort as number;
    }

    if (body.serverPortV6 !== undefined) {
      if (!isValidPort(body.serverPortV6)) return reply.code(400).send({ error: "invalid serverPortV6" });
      updates.serverPortV6 = body.serverPortV6 as number;
    }

    if (body.viewDistance !== undefined) {
      if (typeof body.viewDistance !== "number" || !Number.isInteger(body.viewDistance) || body.viewDistance < 5 || body.viewDistance > 96) return reply.code(400).send({ error: "invalid viewDistance" });
      updates.viewDistance = body.viewDistance;
    }

    if (body.tickDistance !== undefined) {
      if (typeof body.tickDistance !== "number" || !Number.isInteger(body.tickDistance) || body.tickDistance < 4 || body.tickDistance > 12) return reply.code(400).send({ error: "invalid tickDistance" });
      updates.tickDistance = body.tickDistance;
    }

    if (body.allowCheats !== undefined) {
      if (typeof body.allowCheats !== "boolean") return reply.code(400).send({ error: "invalid allowCheats" });
      updates.allowCheats = body.allowCheats;
    }

    if (body.onlineMode !== undefined) {
      if (typeof body.onlineMode !== "boolean") return reply.code(400).send({ error: "invalid onlineMode" });
      updates.onlineMode = body.onlineMode;
    }

    if (body.texturepackRequired !== undefined) {
      if (typeof body.texturepackRequired !== "boolean") return reply.code(400).send({ error: "invalid texturepackRequired" });
      updates.texturepackRequired = body.texturepackRequired;
    }

    if (body.playerIdleTimeout !== undefined) {
      if (typeof body.playerIdleTimeout !== "number" || !Number.isInteger(body.playerIdleTimeout) || body.playerIdleTimeout < 0 || body.playerIdleTimeout > 1440) return reply.code(400).send({ error: "invalid playerIdleTimeout" });
      updates.playerIdleTimeout = body.playerIdleTimeout;
    }

    const merged: BedrockServerSettings = {
      ...existing,
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    try {
      await saveSettingsAndRender(db, merged);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.code(500).send({ error: message });
    }

    return { settings: merged, restartRequired: true };
  });

  app.get("/api/instances/:instanceId/server-properties", async (request, reply) => {
    const params = request.params as { instanceId: string };

    try {
      return await getServerPropertiesEditorPayload(db, params.instanceId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const statusCode = message === "Instance not found" || message === "Settings not found" ? 404 : 500;
      return reply.code(statusCode).send({ error: message });
    }
  });

  app.put("/api/instances/:instanceId/server-properties", async (request, reply) => {
    const params = request.params as { instanceId: string };
    const body = request.body as Partial<UpdateInstanceServerPropertiesRequest>;

    if (typeof body.content !== "string") {
      return reply.code(400).send({ error: "content must be a string" });
    }

    try {
      return await saveServerPropertiesFromEditor(db, params.instanceId, body.content);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const statusCode = message === "Instance not found" || message === "Settings not found" ? 404 : 500;
      return reply.code(statusCode).send({ error: message });
    }
  });
}
