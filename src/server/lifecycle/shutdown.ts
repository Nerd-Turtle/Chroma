import type { FastifyInstance } from "fastify";
import type { Database } from "better-sqlite3";
import type { Server } from "node:http";

import { stopAllBdsProcesses } from "../bds/bdsRuntimeService.js";

export function setupShutdownHandlers(app: FastifyInstance, db: Database, redirectServer?: Server): void {
  let isShuttingDown = false;

  async function shutdown(signal: string): Promise<void> {
    if (isShuttingDown) {
      return;
    }

    isShuttingDown = true;
    app.log.info({ signal }, "Shutting down Chroma");

    try {
      await stopAllBdsProcesses();
      app.log.info("All BDS processes have been asked to stop");
    } catch (error) {
      app.log.error({ error }, "Failed to stop BDS processes cleanly");
    }

    try {
      if (redirectServer) {
        await new Promise<void>((resolve, reject) => {
          redirectServer.close((error) => (error ? reject(error) : resolve()));
        });
        app.log.info("HTTP redirect server has closed");
      }
    } catch (error) {
      app.log.error({ error }, "Failed to close HTTP redirect server cleanly");
    }

    try {
      await app.close();
      app.log.info("Fastify has closed");
    } catch (error) {
      app.log.error({ error }, "Failed to close Fastify cleanly");
    }

    try {
      db.close();
      app.log.info("SQLite database has closed");
    } catch (error) {
      app.log.error({ error }, "Failed to close SQLite database cleanly");
    }

    process.exit(0);
  }

  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });

  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
}
