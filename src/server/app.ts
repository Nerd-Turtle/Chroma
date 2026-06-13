import type { Database } from "better-sqlite3";
import Fastify from "fastify";
import { getDatabasePath, getRuntimePaths } from "./config/paths.js";
import { registerInstanceRoutes } from "./instances/instanceRoutes.js";

export function buildApp(db: Database) {
  const app = Fastify({
    logger: true,
  });

  app.get("/health", async () => {
    return {
      status: "ok",
      app: "chroma",
      name: "Chroma Server Manager",
      database: {
        status: "ok",
        path: getDatabasePath(),
      },
      runtime: getRuntimePaths(),
    };
  });

  void registerInstanceRoutes(app, db);

  return app;
}
