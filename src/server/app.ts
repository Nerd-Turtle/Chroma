import Fastify from "fastify";
import { getRuntimePaths } from "./config/paths.js";
import { registerInstanceRoutes } from "./instances/instanceRoutes.js";

export function buildApp() {
  const app = Fastify({
    logger: true,
  });

  app.get("/health", async () => {
    return {
      status: "ok",
      app: "chroma",
      name: "Chroma Server Manager",
      runtime: getRuntimePaths(),
    };
  });

  void registerInstanceRoutes(app);

  return app;
}
