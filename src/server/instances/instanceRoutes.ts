import type { FastifyInstance } from "fastify";
import type { Database } from "better-sqlite3";
import {
  createInstance,
  getInstance,
  listInstances,
} from "./instanceService.js";
import { registerBdsRoutes } from "../bds/bdsRoutes.js";

export async function registerInstanceRoutes(app: FastifyInstance, db: Database) {
  app.get("/api/instances", async () => {
    return {
      instances: listInstances(db),
    };
  });

  app.post("/api/instances", async (request, reply) => {
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

  app.get("/api/instances/:instanceId", async (request, reply) => {
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

  void registerBdsRoutes(app, db);
}
