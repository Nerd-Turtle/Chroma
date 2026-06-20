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
  getBdsConsoleSnapshot,
  getBdsCurrentLogTailForInstance,
  getBdsLogPageForInstance,
  getBdsRuntimeState,
  listBdsLogFilesForInstance,
  restartBdsForInstance,
  sendBdsConsoleCommand,
  startBdsForInstance,
  stopBdsForInstance,
  subscribeToBdsConsole,
  BdsStartupVerificationError,
} from "./bdsRuntimeService.js";
import { BdsStartValidationError } from "./bdsStartValidationService.js";
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

  app.get("/api/instances/:instanceId/bds/logs", async (request, reply) => {
    const params = request.params as { instanceId: string };

    try {
      const files = await listBdsLogFilesForInstance(db, params.instanceId);
      return { files };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.code(message === "Instance not found" ? 404 : 400).send({ error: message });
    }
  });

  app.get("/api/instances/:instanceId/bds/logs/current/tail", async (request, reply) => {
    const params = request.params as { instanceId: string };
    const query = request.query as Partial<{ limit: string }>;
    const limit = Math.max(1, Math.min(Number.parseInt(query.limit ?? "200", 10) || 200, 1000));

    try {
      const tail = await getBdsCurrentLogTailForInstance(db, params.instanceId, limit);
      return tail;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.code(message === "Instance not found" ? 404 : 400).send({ error: message });
    }
  });

  app.get("/api/instances/:instanceId/bds/logs/:fileName", async (request, reply) => {
    const params = request.params as { instanceId: string; fileName: string };
    const query = request.query as Partial<{ offset: string; limit: string }>;
    const offset = Math.max(0, Number.parseInt(query.offset ?? "0", 10) || 0);
    const limit = Math.max(1, Math.min(Number.parseInt(query.limit ?? "200", 10) || 200, 1000));

    try {
      const page = await getBdsLogPageForInstance(db, params.instanceId, params.fileName, offset, limit);
      return page;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.code(message === "Instance not found" ? 404 : 400).send({ error: message });
    }
  });

  app.get("/api/instances/:instanceId/bds/console/stream", async (request, reply) => {
    const params = request.params as { instanceId: string };

    try {
      const snapshot = await getBdsConsoleSnapshot(db, params.instanceId);
      reply.hijack();

      const raw = reply.raw;
      const writeEvent = (event: string, payload: unknown) => {
        raw.write(`event: ${event}\n`);
        raw.write(`data: ${JSON.stringify(payload)}\n\n`);
      };

      raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      });

      writeEvent("snapshot", snapshot);

      const heartbeat = setInterval(() => {
        raw.write(": keep-alive\n\n");
      }, 15_000);

      const unsubscribe = subscribeToBdsConsole(params.instanceId, (event) => {
        if (event.type === "line") {
          writeEvent("line", event.line);
          return;
        }

        writeEvent("status", event.snapshot);
      });

      const cleanup = () => {
        clearInterval(heartbeat);
        unsubscribe();
      };

      raw.on("close", cleanup);
      raw.on("error", cleanup);
      return reply;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.code(message === "Instance not found" ? 404 : 400).send({ error: message });
    }
  });

  app.post("/api/instances/:instanceId/bds/console/commands", async (request, reply) => {
    const params = request.params as { instanceId: string };
    const body = request.body as Partial<{ command: string }>;

    if (typeof body.command !== "string" || body.command.trim() === "") {
      return reply.code(400).send({ error: "command is required" });
    }

    try {
      const result = await sendBdsConsoleCommand(db, params.instanceId, body.command.trim());
      if (!result.accepted) {
        return reply.code(409).send({
          error: result.error,
          runtime: result.runtime,
        });
      }

      return { accepted: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.code(message === "Instance not found" ? 404 : 400).send({ error: message });
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
      if (error instanceof BdsStartValidationError) {
        return reply.code(409).send({
          error: error.message,
          validation: error.result,
        });
      }

      if (error instanceof BdsStartupVerificationError) {
        return reply.code(409).send({
          error: error.message,
          runtime: error.runtime,
        });
      }

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
