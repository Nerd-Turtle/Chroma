import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ChromaUpgradeProgress } from "../../shared/types/index.js";
import { getRuntimePaths } from "../config/paths.js";
import { CHROMA_UPGRADE_TIMEOUT_MS } from "../../shared/chromaUpdates.js";

export const UPGRADE_TIMEOUT_MS = CHROMA_UPGRADE_TIMEOUT_MS;
let requestPending = false;

export function getChromaUpdateDirectory(): string {
  return process.env.NODE_ENV === "production"
    ? "/opt/chroma/update-state"
    : join(getRuntimePaths().appDir, "update-state");
}

export function readChromaUpgradeProgress(directory = getChromaUpdateDirectory()): ChromaUpgradeProgress | null {
  try {
    const progress = JSON.parse(readFileSync(join(directory, "status.json"), "utf8")) as ChromaUpgradeProgress;
    if (!["installing", "succeeded", "failed"].includes(progress.state) || typeof progress.startedAt !== "string" ||
        typeof progress.version !== "string" || typeof progress.message !== "string" || !Number.isFinite(Date.parse(progress.startedAt))) return null;
    if (progress.state === "installing" && Date.now() - Date.parse(progress.startedAt) > UPGRADE_TIMEOUT_MS) {
      return { ...progress, state: "failed", message: "The updater did not report completion. Check the Chroma updater service logs before retrying." };
    }
    return progress;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new Error("Unable to read Chroma's upgrade status. Check the updater installation.");
  }
}

export function setChromaUpgradeRequestPending(pending: boolean): void {
  requestPending = pending;
}

export function assertChromaUpgradeNotInProgress(): void {
  if (requestPending || readChromaUpgradeProgress()?.state === "installing") {
    throw new Error("Chroma is upgrading. Wait for the upgrade to finish before starting a Minecraft instance.");
  }
}
