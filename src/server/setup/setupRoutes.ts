import type { FastifyInstance } from "fastify";
import type { Database } from "better-sqlite3";
import { isSetupComplete, completeInitialSetup } from "./setupService.js";

export function registerSetupRoutes(app: FastifyInstance, db: Database) {
  app.get("/api/setup/status", async () => {
    return { setupRequired: !isSetupComplete(db) };
  });

  app.post("/api/setup/complete", async (request, reply) => {
    if (isSetupComplete(db)) {
      return reply.code(400).send({ error: "Setup is already completed" });
    }

    const body = request.body as {
      username?: unknown;
      password?: unknown;
      timezone?: unknown;
      language?: unknown;
    };

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
      await completeInitialSetup(db, body.username.trim(), body.password, body.timezone.trim(), body.language.trim());
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.code(400).send({ error: message });
    }
  });
}
