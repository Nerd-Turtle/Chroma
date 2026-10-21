import type { Database } from "better-sqlite3";
import cookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { existsSync } from "node:fs";
import type { ServerOptions as HttpsServerOptions } from "node:https";
import { resolve } from "node:path";
import { getDatabasePath, getRuntimePaths } from "./config/paths.js";
import { registerAuthRoutes } from "./auth/authRoutes.js";
import { registerAuthenticationThrottle } from "./auth/authThrottle.js";
import { registerRequestProtection } from "./auth/requestProtection.js";
import { registerInstanceRoutes } from "./instances/instanceRoutes.js";
import { registerPkiRoutes } from "./pki/pkiRoutes.js";
import type { TlsCertificateMaterial } from "./pki/pkiService.js";
import { registerSetupRoutes } from "./setup/setupRoutes.js";
import { ChromaUpdateService } from "./updates/chromaUpdateService.js";
import { registerChromaUpdateRoutes } from "./updates/chromaUpdateRoutes.js";
import { AddonUpdateService } from "./addons/addonUpdateService.js";
import { registerAddonUpdateRoutes } from "./addons/addonUpdateRoutes.js";

export type BuildAppOptions = {
  https?: HttpsServerOptions;
  webDistDir?: string;
  onCertificateInstalled?: (material: TlsCertificateMaterial) => void | Promise<void>;
  chromaUpdates?: ChromaUpdateService;
  addonUpdates?: AddonUpdateService;
};

export function buildApp(db: Database, options: BuildAppOptions = {}) {
  const app = Fastify({
    logger: true,
    ...(options.https ? { https: options.https } : {}),
  });

  void app.register(cookie);
  registerRequestProtection(app);
  registerAuthenticationThrottle(app);

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
  registerInstanceRoutes(app, db);
  const addonUpdates = options.addonUpdates ?? new AddonUpdateService(db);
  registerAddonUpdateRoutes(app, db, addonUpdates);
  app.addHook("onReady", async () => addonUpdates.recoverInterruptedUpdates(app.log));
  app.addHook("onListen", async () => addonUpdates.startScheduler(app.log));
  app.addHook("onClose", async () => addonUpdates.stopScheduler());
  const updates = options.chromaUpdates ?? new ChromaUpdateService(db);
  registerChromaUpdateRoutes(app, db, updates);
  app.addHook("onListen", async () => updates.startScheduler(app.log));
  app.addHook("onClose", async () => updates.stopScheduler());

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
