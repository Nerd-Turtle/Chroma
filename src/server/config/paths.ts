import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

export type RuntimePaths = {
  appDir: string;
  configDir: string;
  dataDir: string;
  logDir: string;
};

export type PkiPaths = {
  directory: string;
  privateKey: string;
  certificate: string;
  certificateSigningRequest: string;
  backupsDirectory: string;
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

export function getPkiPaths(): PkiPaths {
  const directory = resolve(process.env.CHROMA_PKI_DIR ?? `${getRuntimePaths().configDir}/pki`);

  return {
    directory,
    privateKey: resolve(process.env.CHROMA_TLS_KEY_PATH ?? `${directory}/private.key`),
    certificate: resolve(process.env.CHROMA_TLS_CERT_PATH ?? `${directory}/certificate.pem`),
    certificateSigningRequest: resolve(`${directory}/request.csr`),
    backupsDirectory: resolve(`${directory}/backups`),
  };
}

export async function ensureRuntimePaths(): Promise<void> {
  const runtime = getRuntimePaths();
  await Promise.all(
    Object.values(runtime).map((dir) => mkdir(dir, { recursive: true }))
  );
}
