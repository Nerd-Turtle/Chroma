import type { Database } from "better-sqlite3";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import { getDatabasePath, getRuntimePaths } from "./config/paths.js";
import { registerInstanceRoutes } from "./instances/instanceRoutes.js";
import { registerSetupRoutes } from "./setup/setupRoutes.js";
import { registerAuthRoutes } from "./auth/authRoutes.js";

export function buildApp(db: Database) {
  const app = Fastify({
    logger: true,
  });

  void app.register(cookie);

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

  void registerSetupRoutes(app, db);
  void registerAuthRoutes(app, db);
  void registerInstanceRoutes(app, db);

  return app;
}
