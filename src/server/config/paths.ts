import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

export type RuntimePaths = {
  appDir: string;
  configDir: string;
  dataDir: string;
  logDir: string;
};

const isDevelopment = process.env.NODE_ENV !== "production";

function resolveRuntimePaths(paths: RuntimePaths): RuntimePaths {
  return {
    appDir: resolve(paths.appDir),
    configDir: resolve(paths.configDir),
    dataDir: resolve(paths.dataDir),
    logDir: resolve(paths.logDir),
  };
}

export function getRuntimePaths(): RuntimePaths {
  if (isDevelopment) {
    return resolveRuntimePaths({
      appDir: ".runtime/opt/chroma",
      configDir: ".runtime/etc/chroma",
      dataDir: ".runtime/var/lib/chroma",
      logDir: ".runtime/var/log/chroma",
    });
  }

  return resolveRuntimePaths({
    appDir: process.env.CHROMA_APP_DIR ?? "/opt/chroma",
    configDir: process.env.CHROMA_CONFIG_DIR ?? "/etc/chroma",
    dataDir: process.env.CHROMA_DATA_DIR ?? "/var/lib/chroma",
    logDir: process.env.CHROMA_LOG_DIR ?? "/var/log/chroma",
  });
}

export function getDatabasePath(): string {
  const runtime = getRuntimePaths();
  return `${runtime.dataDir}/chroma.sqlite`;
}

export async function ensureRuntimePaths(): Promise<void> {
  const runtime = getRuntimePaths();
  await Promise.all(
    Object.values(runtime).map((dir) => mkdir(dir, { recursive: true }))
  );
}
