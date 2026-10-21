import { isTimeZone } from "../../shared/validation.js";
import { ConflictError, InputValidationError } from "../utils/httpErrors.js";
import type { Database } from "better-sqlite3";
import type { FastifyInstance } from "fastify";
import type { SetupCompleteRequest, SetupStatusResponse, UpdateAppSettingsRequest } from "../../shared/types/index.js";
import { PasswordHashBusyError } from "../auth/passwords.js";
import { requireAuthenticated } from "../auth/authGuard.js";
import { getDashboardSummary } from "../dashboard/dashboardService.js";
import { completeInitialSetup, getAppSettings, isSetupComplete, updateAppSettings } from "./setupService.js";

export function registerSetupRoutes(app: FastifyInstance, db: Database): void {
  app.get("/api/setup/status", async (): Promise<SetupStatusResponse> => {
    return {
      setupRequired: !isSetupComplete(db),
    };
  });

  app.post("/api/setup/complete", { bodyLimit: 16 * 1024 }, async (request, reply) => {
    const body = (request.body ?? {}) as Partial<SetupCompleteRequest>;
    if (isSetupComplete(db)) {
      return reply.code(409).send({ error: "Setup is already complete" });
    }

    if (typeof body.username !== "string" || body.username.trim().length < 3 || body.username.trim().length > 64) {
      return reply.code(400).send({ error: "username must be 3-64 characters" });
    }

    if (typeof body.password !== "string" || body.password.length < 8 || body.password.length > 1024) {
      return reply.code(400).send({ error: "password must be 8-1024 characters" });
    }

    if (typeof body.timezone !== "string" || !isTimeZone(body.timezone.trim())) {
      return reply.code(400).send({ error: "timezone must be a valid named IANA timezone" });
    }

    if (typeof body.language !== "string" || body.language.trim() === "") {
      return reply.code(400).send({ error: "language is required" });
    }

    if (body.curseForgeApiKey !== undefined) {
      if (typeof body.curseForgeApiKey !== "string") {
        return reply.code(400).send({ error: "curseForgeApiKey must be a string" });
      }

      if (body.curseForgeApiKey.trim().length > 512) {
        return reply.code(400).send({ error: "curseForgeApiKey must be 512 characters or fewer" });
      }
    }

    try {
      const setupInput: SetupCompleteRequest = {
        username: body.username.trim(),
        password: body.password,
        timezone: body.timezone.trim(),
        language: body.language.trim(),
        ...(body.curseForgeApiKey?.trim() ? { curseForgeApiKey: body.curseForgeApiKey.trim() } : {}),
      };

      await completeInitialSetup(db, setupInput);
      return { success: true };
    } catch (error) {
      if (error instanceof PasswordHashBusyError) return reply.header("Retry-After", 5).code(429).send({ error: error.message });
      if (error instanceof InputValidationError || error instanceof ConflictError) return reply.code(error.statusCode).send({ error: error.message });
      request.log.error({ err: error }, "Initial setup failed internally");
      return reply.code(500).send({ error: "Unable to complete setup. Please try again." });
    }
  });

  app.get("/api/dashboard/summary", { preHandler: requireAuthenticated(db) }, async () => {
    return {
      summary: await getDashboardSummary(db),
    };
  });

  app.get("/api/app/settings", { preHandler: requireAuthenticated(db) }, async (_request, reply) => {
    const settings = getAppSettings(db);

    if (!settings) {
      return reply.code(404).send({ error: "Application settings not found" });
    }

    return { settings };
  });

  app.put("/api/app/settings", { preHandler: requireAuthenticated(db) }, async (request, reply) => {
    const body = (request.body ?? {}) as Partial<UpdateAppSettingsRequest>;

    if (body.sessionIdleTimeoutMinutes !== undefined &&
      (typeof body.sessionIdleTimeoutMinutes !== "number" || !Number.isInteger(body.sessionIdleTimeoutMinutes) ||
        body.sessionIdleTimeoutMinutes < 1 || body.sessionIdleTimeoutMinutes > 120)) {
      return reply.code(400).send({ error: "sessionIdleTimeoutMinutes must be an integer between 1 and 120" });
    }

    if (typeof body.timezone !== "string" || !isTimeZone(body.timezone.trim())) {
      return reply.code(400).send({ error: "timezone must be a valid named IANA timezone" });
    }

    if (typeof body.language !== "string" || body.language.trim() === "") {
      return reply.code(400).send({ error: "language is required" });
    }

    if (
      typeof body.notificationDurationSeconds !== "number" ||
      !Number.isInteger(body.notificationDurationSeconds) ||
      body.notificationDurationSeconds < 1 ||
      body.notificationDurationSeconds > 30
    ) {
      return reply.code(400).send({ error: "notificationDurationSeconds must be an integer between 1 and 30" });
    }

    if (body.curseForgeApiKey !== undefined) {
      if (typeof body.curseForgeApiKey !== "string") {
        return reply.code(400).send({ error: "curseForgeApiKey must be a string" });
      }

      if (body.curseForgeApiKey.trim().length > 512) {
        return reply.code(400).send({ error: "curseForgeApiKey must be 512 characters or fewer" });
      }
    }

    if (body.clearCurseForgeApiKey !== undefined && typeof body.clearCurseForgeApiKey !== "boolean") {
      return reply.code(400).send({ error: "clearCurseForgeApiKey must be a boolean" });
    }

    try {
      const settingsInput: UpdateAppSettingsRequest = {
        timezone: body.timezone.trim(),
        language: body.language.trim(),
        notificationDurationSeconds: body.notificationDurationSeconds,
        ...(body.sessionIdleTimeoutMinutes !== undefined ? { sessionIdleTimeoutMinutes: body.sessionIdleTimeoutMinutes } : {}),
        ...(body.curseForgeApiKey?.trim() ? { curseForgeApiKey: body.curseForgeApiKey.trim() } : {}),
        ...(body.clearCurseForgeApiKey !== undefined ? { clearCurseForgeApiKey: body.clearCurseForgeApiKey } : {}),
      };

      const settings = updateAppSettings(db, settingsInput);

      return { settings };
    } catch (error) {
      if (error instanceof InputValidationError) return reply.code(400).send({ error: error.message });
      request.log.error({ err: error }, "Application settings update failed internally");
      return reply.code(500).send({ error: "Unable to update application settings. Please try again." });
    }
  });
}
