import type { FastifyInstance } from "fastify";
import multipart from "@fastify/multipart";
import type { Database } from "better-sqlite3";
import type { CreateInstanceRequest, UpdateInstanceRequest } from "../../shared/types/index.js";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { requireAuthenticated } from "../auth/authGuard.js";
import {
  createInstance,
  deleteInstance,
  getInstance,
  listInstances,
  updateInstance,
} from "./instanceService.js";
import { listRecentInstanceRuntimeEvents } from "./instanceRuntimeEventService.js";
import { registerAddonRoutes } from "../addons/addonRoutes.js";
import { registerBdsRoutes } from "../bds/bdsRoutes.js";
import { registerInstanceSettingsRoutes } from "./instanceSettingsRoutes.js";
import { createManagedExportBackupZip, getExportBackupRecord, importInstanceBackupZip } from "./instanceBackupService.js";
import { createId } from "../utils/createId.js";
import { getRuntimePaths } from "../config/paths.js";

export function registerInstanceRoutes(app: FastifyInstance, db: Database): void {
  // Queue plugins synchronously; Fastify loads them in registration order.
  void app.register(multipart, {
    limits: {
      files: 1,
      fileSize: 16 * 1024 * 1024 * 1024,
    },
  });

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

    protectedApp.get("/api/instances/:instanceId/events", async (request, reply) => {
      const params = request.params as { instanceId: string };
      const instance = getInstance(db, params.instanceId);

      if (!instance) {
        return reply.code(404).send({ error: "Instance not found" });
      }

      return {
        events: listRecentInstanceRuntimeEvents(db, params.instanceId),
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

      const instance = await updateInstance(db, params.instanceId, {
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

    protectedApp.delete("/api/instances/:instanceId", async (request, reply) => {
      const params = request.params as { instanceId: string };

      try {
        await deleteInstance(db, params.instanceId);
        return {
          success: true,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return reply.code(message === "Instance not found" ? 404 : 400).send({ error: message });
      }
    });

    protectedApp.post("/api/instances/:instanceId/backups/export", async (request, reply) => {
      const params = request.params as { instanceId: string };

      try {
        const backup = await createManagedExportBackupZip(db, params.instanceId);
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

    protectedApp.post("/api/instances/backups/import", async (request, reply) => {
      const upload = await request.file();
      if (!upload) {
        return reply.code(400).send({ error: "A backup ZIP file is required." });
      }
      if (!upload.filename.toLowerCase().endsWith(".zip")) {
        upload.file.resume();
        return reply.code(400).send({ error: "Backup files must use the .zip extension." });
      }

      const uploadDirectory = join(getRuntimePaths().dataDir, "imports", "uploads");
      const uploadPath = join(uploadDirectory, `${createId("backup")}.zip`);
      try {
        await mkdir(uploadDirectory, { recursive: true });
        await pipeline(upload.file, createWriteStream(uploadPath, { flags: "wx" }));
        const imported = await importInstanceBackupZip(db, uploadPath);
        return reply.code(201).send(imported);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return reply.code(400).send({ error: message });
      } finally {
        await rm(uploadPath, { force: true });
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
    void registerAddonRoutes(protectedApp, db);
  });
}
