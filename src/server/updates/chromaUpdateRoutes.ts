import type { Database } from "better-sqlite3";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { requireAuthenticated } from "../auth/authGuard.js";
import type { ChromaUpdateService } from "./chromaUpdateService.js";

export function registerChromaUpdateRoutes(app: FastifyInstance, db: Database, service: ChromaUpdateService): void {
  const preHandler = [requireAuthenticated(db), async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.authUser?.role !== "admin") return reply.code(403).send({ error: "Administrator access is required for Chroma updates." });
  }];
  app.get("/api/app/updates", { preHandler }, async () => service.getStatus());
  app.post("/api/app/updates/check", { preHandler }, async () => service.checkForUpdates());
  app.put("/api/app/updates/settings", { preHandler }, async (request, reply) => {
    try {
      service.saveSettings(request.body);
      return await service.getStatus();
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : "Unable to save update settings." });
    }
  });
  app.post("/api/app/updates/install", { preHandler }, async (request, reply) => {
    const body = request.body as { confirmed?: unknown; version?: unknown } | null;
    if (body?.confirmed !== true || typeof body.version !== "string") {
      return reply.code(400).send({ error: "Confirm the upgrade and specify the displayed Chroma version." });
    }
    try { return reply.code(202).send(await service.installUpdate(body.version)); }
    catch (error) { return reply.code(409).send({ error: error instanceof Error ? error.message : "Unable to start the upgrade." }); }
  });
}
