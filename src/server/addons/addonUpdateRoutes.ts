import type { Database } from "better-sqlite3";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { requireAuthenticated } from "../auth/authGuard.js";
import type { AddonUpdateService } from "./addonUpdateService.js";

export function registerAddonUpdateRoutes(app: FastifyInstance, db: Database, service: AddonUpdateService): void {
  const authenticated = requireAuthenticated(db);
  const admin = [authenticated, async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.authUser?.role !== "admin") return reply.code(403).send({ error: "Administrator access is required for addon updates." });
  }];
  app.get("/api/addons/updates", { preHandler: authenticated }, async () => service.getSummary());
  app.post("/api/addons/updates/check", { preHandler: admin }, async () => service.checkLibrary());
  app.post("/api/instances/:instanceId/addons/updates/:addonId/retry", { preHandler: admin }, async (request, reply) => {
    if ((request.body as { confirmed?: unknown } | null)?.confirmed !== true) return reply.code(400).send({ error: "Confirm the addon update retry." });
    const params = request.params as { instanceId: string; addonId: string };
    try { return await service.retry(params.instanceId, params.addonId); }
    catch (error) { return reply.code(409).send({ error: error instanceof Error ? error.message : "Unable to retry this addon update." }); }
  });
}
