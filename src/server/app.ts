import Fastify from "fastify";
import { getRuntimePaths } from "./config/paths.js";

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

  app.get("/api/instances", async () => {
    return {
      instances: [],
    };
  });

  return app;
}
