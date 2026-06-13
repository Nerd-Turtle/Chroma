import type { Database } from "better-sqlite3";
import type { FastifyInstance } from "fastify";
import type { SetupCompleteRequest, SetupStatusResponse } from "../../shared/types/index.js";
import { requireAuthenticated } from "../auth/authGuard.js";
import { completeInitialSetup, getDashboardSummary, isSetupComplete } from "./setupService.js";

export function registerSetupRoutes(app: FastifyInstance, db: Database): void {
  app.get("/api/setup/status", async (): Promise<SetupStatusResponse> => {
    return {
      setupRequired: !isSetupComplete(db),
    };
  });

  app.post("/api/setup/complete", async (request, reply) => {
    const body = request.body as Partial<SetupCompleteRequest>;
    if (isSetupComplete(db)) {
      return reply.code(400).send({ error: "Setup is already complete" });
    }

    if (typeof body.username !== "string" || body.username.trim().length < 3 || body.username.trim().length > 64) {
      return reply.code(400).send({ error: "username must be 3-64 characters" });
    }

    if (typeof body.password !== "string" || body.password.length < 8) {
      return reply.code(400).send({ error: "password must be at least 8 characters" });
    }

    if (typeof body.timezone !== "string" || body.timezone.trim() === "") {
      return reply.code(400).send({ error: "timezone is required" });
    }

    if (typeof body.language !== "string" || body.language.trim() === "") {
      return reply.code(400).send({ error: "language is required" });
    }

    try {
      await completeInitialSetup(db, {
        username: body.username.trim(),
        password: body.password,
        timezone: body.timezone.trim(),
        language: body.language.trim(),
      });
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Setup failed";
      return reply.code(400).send({ error: message });
    }
  });

  app.get("/api/dashboard/summary", { preHandler: requireAuthenticated(db) }, async () => {
    return {
      summary: getDashboardSummary(db),
    };
  });
}
