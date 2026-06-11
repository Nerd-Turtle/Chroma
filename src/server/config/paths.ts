import { mkdir } from "node:fs/promises";

export type RuntimePaths = {
  appDir: string;
  configDir: string;
  dataDir: string;
  logDir: string;
};

const isDevelopment = process.env.NODE_ENV !== "production";

export function getRuntimePaths(): RuntimePaths {
  if (isDevelopment) {
    return {
      appDir: ".runtime/opt/chroma",
      configDir: ".runtime/etc/chroma",
      dataDir: ".runtime/var/lib/chroma",
      logDir: ".runtime/var/log/chroma",
    };
  }

  return {
    appDir: process.env.CHROMA_APP_DIR ?? "/opt/chroma",
    configDir: process.env.CHROMA_CONFIG_DIR ?? "/etc/chroma",
    dataDir: process.env.CHROMA_DATA_DIR ?? "/var/lib/chroma",
    logDir: process.env.CHROMA_LOG_DIR ?? "/var/log/chroma",
  };
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
