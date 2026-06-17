import type { FastifyInstance } from "fastify";
import type { Database } from "better-sqlite3";
import type { CreateInstanceRequest, UpdateInstanceRequest } from "../../shared/types/index.js";
import { createReadStream } from "node:fs";
import { requireAuthenticated } from "../auth/authGuard.js";
import {
  createInstance,
  getInstance,
  listInstances,
  updateInstance,
} from "./instanceService.js";
import { registerBdsRoutes } from "../bds/bdsRoutes.js";
import { registerInstanceSettingsRoutes } from "./instanceSettingsRoutes.js";
import { createExportBackupZip, getExportBackupRecord } from "./instanceBackupService.js";

export async function registerInstanceRoutes(app: FastifyInstance, db: Database) {
  void app.register(async (protectedApp) => {
    protectedApp.addHook("preHandler", requireAuthenticated(db));

    const isValidWeekday = (value: unknown): value is UpdateInstanceRequest["updateCheckWeekday"] =>
      value === "monday" ||
      value === "tuesday" ||
      value === "wednesday" ||
      value === "thursday" ||
      value === "friday" ||
      value === "saturday" ||
      value === "sunday";

    protectedApp.get("/api/instances", async () => {
      return {
        instances: listInstances(db),
      };
    });

    protectedApp.post("/api/instances", async (request, reply) => {
      const body = request.body as Partial<CreateInstanceRequest>;

      if (typeof body.friendlyName !== "string" || body.friendlyName.trim() === "") {
        return reply.code(400).send({
          error: "friendlyName is required",
        });
      }

      if (typeof body.bdsVersion !== "string" || body.bdsVersion.trim() === "") {
        return reply.code(400).send({
          error: "bdsVersion is required",
        });
      }

      if (typeof body.automaticUpdatesEnabled !== "boolean") {
        return reply.code(400).send({
          error: "automaticUpdatesEnabled is required",
        });
      }

      if (body.updateCheckFrequency !== "daily" && body.updateCheckFrequency !== "weekly") {
        return reply.code(400).send({
          error: "updateCheckFrequency must be daily or weekly",
        });
      }

      if (!isValidWeekday(body.updateCheckWeekday)) {
        return reply.code(400).send({
          error: "updateCheckWeekday must be a valid weekday",
        });
      }

      if (typeof body.updateCheckTime !== "string" || !/^\d{2}:\d{2}$/.test(body.updateCheckTime)) {
        return reply.code(400).send({
          error: "updateCheckTime must be in HH:MM format",
        });
      }

      const instance = await createInstance(db, {
        friendlyName: body.friendlyName.trim(),
        bdsVersion: body.bdsVersion.trim(),
        automaticUpdatesEnabled: body.automaticUpdatesEnabled,
        updateCheckFrequency: body.updateCheckFrequency,
        updateCheckTime: body.updateCheckTime,
        updateCheckWeekday: body.updateCheckWeekday,
      });

      return reply.code(201).send({
        instance,
      });
    });

    protectedApp.get("/api/instances/:instanceId", async (request, reply) => {
      const params = request.params as {
        instanceId: string;
      };

      const instance = getInstance(db, params.instanceId);

      if (!instance) {
        return reply.code(404).send({
          error: "Instance not found",
        });
      }

      return {
        instance,
      };
    });

    protectedApp.put("/api/instances/:instanceId", async (request, reply) => {
      const params = request.params as { instanceId: string };
      const body = request.body as Partial<UpdateInstanceRequest>;

      if (typeof body.friendlyName !== "string" || body.friendlyName.trim() === "") {
        return reply.code(400).send({ error: "friendlyName is required" });
      }

      if (typeof body.automaticUpdatesEnabled !== "boolean") {
        return reply.code(400).send({ error: "automaticUpdatesEnabled is required" });
      }

      if (body.updateCheckFrequency !== "daily" && body.updateCheckFrequency !== "weekly") {
        return reply.code(400).send({ error: "updateCheckFrequency must be daily or weekly" });
      }

      if (!isValidWeekday(body.updateCheckWeekday)) {
        return reply.code(400).send({ error: "updateCheckWeekday must be a valid weekday" });
      }

      if (typeof body.updateCheckTime !== "string" || !/^\d{2}:\d{2}$/.test(body.updateCheckTime)) {
        return reply.code(400).send({ error: "updateCheckTime must be in HH:MM format" });
      }

      const instance = updateInstance(db, params.instanceId, {
        friendlyName: body.friendlyName.trim(),
        automaticUpdatesEnabled: body.automaticUpdatesEnabled,
        updateCheckFrequency: body.updateCheckFrequency,
        updateCheckTime: body.updateCheckTime,
        updateCheckWeekday: body.updateCheckWeekday,
      });

      if (!instance) {
        return reply.code(404).send({ error: "Instance not found" });
      }

      return { instance };
    });

    protectedApp.post("/api/instances/:instanceId/backups/export", async (request, reply) => {
      const params = request.params as { instanceId: string };

      try {
        const backup = await createExportBackupZip(db, params.instanceId);
        return reply.code(201).send({
          backupId: backup.backupId,
          fileName: backup.fileName,
          createdAt: backup.createdAt,
          mode: backup.mode,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const statusCode = message === "Instance not found" ? 404 : 400;
        return reply.code(statusCode).send({ error: message });
      }
    });

    protectedApp.get("/api/instances/:instanceId/backups/export/:backupId/download", async (request, reply) => {
      const params = request.params as { instanceId: string; backupId: string };

      try {
        const backup = await getExportBackupRecord(db, params.instanceId, params.backupId);
        reply.header("Content-Type", "application/zip");
        reply.header("Content-Disposition", `attachment; filename="${backup.fileName}"`);
        return reply.send(createReadStream(backup.path));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const statusCode = message === "Backup not found" || message === "Instance not found" ? 404 : 400;
        return reply.code(statusCode).send({ error: message });
      }
    });

    void registerBdsRoutes(protectedApp, db);
    void registerInstanceSettingsRoutes(protectedApp, db);
  });
}
