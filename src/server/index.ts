import { buildApp } from "./app.js";
import { ensureRuntimePaths, getDatabasePath, getRuntimePaths } from "./config/paths.js";
import { openDatabase } from "./db/database.js";
import { runMigrations } from "./db/migrations.js";
import { startInstanceAutoUpdateScheduler } from "./instances/instanceAutoUpdateService.js";
import { setupShutdownHandlers } from "./lifecycle/shutdown.js";

const port = Number(process.env.CHROMA_PORT ?? 3000);
const host = process.env.CHROMA_HOST ?? "127.0.0.1";

const runtimePaths = getRuntimePaths();
const databasePath = getDatabasePath();

try {
  await ensureRuntimePaths();
  const db = openDatabase(databasePath);
  runMigrations(db);
  const app = buildApp(db);
  setupShutdownHandlers(app, db);
  startInstanceAutoUpdateScheduler(db, app.log);

  app.log.info({ runtime: runtimePaths, databasePath }, "Chroma starting");
  await app.listen({ host, port });
} catch (error) {
  console.error("Chroma failed to start", error);
  process.exit(1);
}
