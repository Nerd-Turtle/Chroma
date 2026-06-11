import type { FastifyInstance } from "fastify";
import type { Database } from "better-sqlite3";
import {
  getBdsStatusForInstance,
  installBdsForInstance,
} from "./bdsInstallService.js";

export async function registerBdsRoutes(app: FastifyInstance, db: Database) {
  app.get("/api/instances/:instanceId/bds/status", async (request, reply) => {
    const params = request.params as {
      instanceId: string;
    };

    try {
      const bds = await getBdsStatusForInstance(db, params.instanceId);
      return { bds };
    } catch (error) {
      return reply.code(404).send({ error: "Instance not found" });
    }
  });

  app.post("/api/instances/:instanceId/bds/install", async (request, reply) => {
    const params = request.params as {
      instanceId: string;
    };

    try {
      const bds = await installBdsForInstance(db, params.instanceId);
      return { bds };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.code(400).send({ error: message });
    }
  });
}
