import { buildApp } from "./app.js";
import { initializeBdsRuntimeStateSynchronization, reconcileBdsRuntimeStates } from "./bds/bdsRuntimeService.js";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { Server as TlsServer } from "node:https";
import { ensureRuntimePaths, getDatabasePath, getPkiPaths, getRuntimePaths } from "./config/paths.js";
import { openDatabase } from "./db/database.js";
import { runMigrations } from "./db/migrations.js";
import { startInstanceAutoUpdateScheduler } from "./instances/instanceAutoUpdateService.js";
import { setupShutdownHandlers } from "./lifecycle/shutdown.js";

const tlsEnabled = process.env.CHROMA_TLS_ENABLED === "true";
const port = Number(process.env.CHROMA_PORT ?? (tlsEnabled ? 443 : 3000));
const host = process.env.CHROMA_HOST ?? (tlsEnabled ? "0.0.0.0" : "127.0.0.1");

const runtimePaths = getRuntimePaths();
const databasePath = getDatabasePath();

function getRedirectHostname(request: IncomingMessage): string {
  const configuredHostname = process.env.CHROMA_PUBLIC_HOST?.trim();
  const requestedHost = request.headers.host?.trim();
  const candidate = configuredHostname || requestedHost || "localhost";

  if (/^\[[0-9a-f:]+\](?::\d+)?$/i.test(candidate)) {
    return candidate.replace(/:\d+$/, "");
  }
  if (/^[a-z0-9.-]+(?::\d+)?$/i.test(candidate)) {
    return candidate.replace(/:\d+$/, "");
  }

  return "localhost";
}

async function startHttpRedirectServer(httpsPort: number): Promise<Server | undefined> {
  if (!tlsEnabled || process.env.CHROMA_HTTP_REDIRECT_ENABLED === "false") {
    return undefined;
  }

  const redirectPort = Number(process.env.CHROMA_HTTP_PORT ?? 80);
  const redirectHost = process.env.CHROMA_HTTP_HOST ?? host;
  const server = createServer((request, response) => {
    const hostname = getRedirectHostname(request);
    const portSuffix = httpsPort === 443 ? "" : `:${httpsPort}`;
    const requestPath = request.url?.startsWith("/") ? request.url : "/";
    response.writeHead(308, {
      Location: `https://${hostname}${portSuffix}${requestPath}`,
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    });
    response.end("Redirecting to HTTPS\n");
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(redirectPort, redirectHost, () => {
      server.off("error", reject);
      resolve();
    });
  });

  return server;
}

try {
  await ensureRuntimePaths();
  const db = openDatabase(databasePath);
  runMigrations(db);
  const pkiPaths = getPkiPaths();
  const tlsMaterial = tlsEnabled
    ? {
        key: await readFile(pkiPaths.privateKey),
        cert: await readFile(pkiPaths.certificate),
      }
    : undefined;

  let app: ReturnType<typeof buildApp>;
  app = buildApp(db, {
    ...(tlsMaterial ? { https: tlsMaterial } : {}),
    webDistDir: process.env.CHROMA_WEB_DIST_DIR ?? `${runtimePaths.appDir}/web/dist`,
    ...(tlsEnabled
      ? {
          onCertificateInstalled: (material) => {
            (app.server as TlsServer).setSecureContext(material);
          },
        }
      : {}),
  });
  initializeBdsRuntimeStateSynchronization(db, app.log);
  await reconcileBdsRuntimeStates(db, app.log);
  startInstanceAutoUpdateScheduler(db, app.log);

  app.log.info({ runtime: runtimePaths, databasePath, tlsEnabled }, "Chroma starting");
  await app.listen({ host, port });
  const redirectServer = await startHttpRedirectServer(port);
  setupShutdownHandlers(app, db, redirectServer);
  if (redirectServer) {
    app.log.info(
      { host: process.env.CHROMA_HTTP_HOST ?? host, port: Number(process.env.CHROMA_HTTP_PORT ?? 80) },
      "HTTP redirect server listening",
    );
  }
} catch (error) {
  console.error("Chroma failed to start", error);
  process.exit(1);
}
