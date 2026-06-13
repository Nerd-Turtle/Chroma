import type { FastifyInstance } from "fastify";
import type { Database } from "better-sqlite3";
import { requireAuthenticated } from "../auth/authGuard.js";
import {
  createInstance,
  getInstance,
  listInstances,
} from "./instanceService.js";
import { registerBdsRoutes } from "../bds/bdsRoutes.js";
import { registerInstanceSettingsRoutes } from "./instanceSettingsRoutes.js";

export async function registerInstanceRoutes(app: FastifyInstance, db: Database) {
  void app.register(async (protectedApp) => {
    protectedApp.addHook("preHandler", requireAuthenticated(db));

    protectedApp.get("/api/instances", async () => {
      return {
        instances: listInstances(db),
      };
    });

    protectedApp.post("/api/instances", async (request, reply) => {
      const body = request.body as {
        friendlyName?: unknown;
        bdsVersion?: unknown;
      };

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

      const instance = await createInstance(db, {
        friendlyName: body.friendlyName.trim(),
        bdsVersion: body.bdsVersion.trim(),
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

    void registerBdsRoutes(protectedApp, db);
    void registerInstanceSettingsRoutes(protectedApp, db);
  });
}
