import type { FastifyInstance } from "fastify";
import type { Database } from "better-sqlite3";

export function setupShutdownHandlers(app: FastifyInstance, db: Database): void {
  let isShuttingDown = false;

  async function shutdown(signal: string): Promise<void> {
    if (isShuttingDown) {
      return;
    }

    isShuttingDown = true;
    app.log.info({ signal }, "Shutting down Chroma");

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
