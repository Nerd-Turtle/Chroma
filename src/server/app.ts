import type { Database } from "better-sqlite3";
import cookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { existsSync } from "node:fs";
import type { ServerOptions as HttpsServerOptions } from "node:https";
import { resolve } from "node:path";
import { getDatabasePath, getRuntimePaths } from "./config/paths.js";
import { registerAuthRoutes } from "./auth/authRoutes.js";
import { registerInstanceRoutes } from "./instances/instanceRoutes.js";
import { registerPkiRoutes } from "./pki/pkiRoutes.js";
import type { TlsCertificateMaterial } from "./pki/pkiService.js";
import { registerSetupRoutes } from "./setup/setupRoutes.js";

export type BuildAppOptions = {
  https?: HttpsServerOptions;
  webDistDir?: string;
  onCertificateInstalled?: (material: TlsCertificateMaterial) => void | Promise<void>;
};

export function buildApp(db: Database, options: BuildAppOptions = {}) {
  const app = Fastify({
    logger: true,
    ...(options.https ? { https: options.https } : {}),
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

  registerSetupRoutes(app, db);
  registerAuthRoutes(app, db);
  registerPkiRoutes(app, db, {
    ...(options.onCertificateInstalled ? { onCertificateInstalled: options.onCertificateInstalled } : {}),
  });
  void registerInstanceRoutes(app, db);

  const webDistDir = options.webDistDir ? resolve(options.webDistDir) : undefined;
  if (webDistDir && existsSync(resolve(webDistDir, "index.html"))) {
    void app.register(fastifyStatic, {
      root: webDistDir,
      wildcard: false,
    });

    app.setNotFoundHandler((request, reply) => {
      if (request.method === "GET" && !request.url.startsWith("/api/")) {
        return reply.sendFile("index.html");
      }

      return reply.code(404).send({ error: "Not found" });
    });
  }

  return app;
}
