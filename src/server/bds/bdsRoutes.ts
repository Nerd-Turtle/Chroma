import type { FastifyInstance } from "fastify";
import type { Database } from "better-sqlite3";
import {
  discoverBdsDownloadUrl,
} from "./bdsDiscoveryService.js";
import {
  getBdsStatusForInstance,
  installBdsForInstance,
} from "./bdsInstallService.js";
import {
  getBdsRuntimeState,
  startBdsForInstance,
  stopBdsForInstance,
  restartBdsForInstance,
} from "./bdsRuntimeService.js";
import { runManualUpdateForInstance } from "../instances/instanceAutoUpdateService.js";

export async function registerBdsRoutes(app: FastifyInstance, db: Database) {
  app.get("/api/bds/latest", async (_request, reply) => {
    try {
      return await discoverBdsDownloadUrl();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.code(500).send({ error: message });
    }
  });

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

  app.get("/api/instances/:instanceId/bds/runtime", async (request, reply) => {
    const params = request.params as {
      instanceId: string;
    };

    try {
      const runtime = await getBdsRuntimeState(db, params.instanceId);
      return { runtime };
    } catch (error) {
      return reply.code(404).send({ error: "Instance not found" });
    }
  });

  app.post("/api/instances/:instanceId/bds/start", async (request, reply) => {
    const params = request.params as {
      instanceId: string;
    };

    try {
      const runtime = await startBdsForInstance(db, params.instanceId);
      return { runtime };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.code(400).send({ error: message });
    }
  });

  app.post("/api/instances/:instanceId/bds/stop", async (request, reply) => {
    const params = request.params as {
      instanceId: string;
    };

    try {
      const runtime = await stopBdsForInstance(db, params.instanceId);
      return { runtime };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.code(400).send({ error: message });
    }
  });

  app.post("/api/instances/:instanceId/bds/restart", async (request, reply) => {
    const params = request.params as {
      instanceId: string;
    };

    try {
      const runtime = await restartBdsForInstance(db, params.instanceId);
      return { runtime };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.code(400).send({ error: message });
    }
  });

  app.post("/api/instances/:instanceId/bds/update", async (request, reply) => {
    const params = request.params as {
      instanceId: string;
    };

    try {
      const bds = await runManualUpdateForInstance(db, app.log, params.instanceId);
      return { bds };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.code(400).send({ error: message });
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
