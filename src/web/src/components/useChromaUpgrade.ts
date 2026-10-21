import { useCallback, useRef, useState } from "react";
import type { ChromaUpdateStatus } from "../../../shared/types/index.js";
import { ApiRequestError, getChromaUpdateStatus, installChromaUpdate } from "../api/chromaApi.js";

export const UPGRADE_STORAGE_KEY = "chroma:upgrade-recovery";
export type UpgradeAttempt = {
  version: string;
  previousVersion: string;
  requestedAt: number;
  monitoringStartedAt: number;
  previousJobStartedAt: string | null;
  jobStartedAt: string | null;
  accepted: boolean;
  reloaded: boolean;
};

function readAttempt(): UpgradeAttempt | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(UPGRADE_STORAGE_KEY) ?? "null") as UpgradeAttempt | null;
    const stable = (version: unknown) => typeof version === "string" && version.length <= 64 && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version);
    const timestamp = (date: unknown) => date === null || (typeof date === "string" && Number.isFinite(Date.parse(date)));
    if (value && stable(value.version) && stable(value.previousVersion) && Number.isFinite(value.requestedAt) &&
        value.requestedAt <= Date.now() + 60_000 && value.requestedAt > Date.now() - 24 * 60 * 60_000 &&
        Number.isFinite(value.monitoringStartedAt) && value.monitoringStartedAt <= Date.now() + 60_000 && value.monitoringStartedAt > Date.now() - 24 * 60 * 60_000 &&
        timestamp(value.previousJobStartedAt) && timestamp(value.jobStartedAt) &&
        typeof value.accepted === "boolean" && typeof value.reloaded === "boolean") return value;
  } catch { /* Storage may be unavailable; live recovery still works in this tab. */ }
  return null;
}

function storeAttempt(attempt: UpgradeAttempt | null): boolean {
  try {
    if (attempt) sessionStorage.setItem(UPGRADE_STORAGE_KEY, JSON.stringify(attempt));
    else sessionStorage.removeItem(UPGRADE_STORAGE_KEY);
    return true;
  } catch { return false; }
}

// App owns this hook so an authentication redirect cannot unmount recovery.
// The stored marker contains no credentials and never authorizes an operation.
export function useChromaUpgrade() {
  const [attempt, setAttempt] = useState<UpgradeAttempt | null>(readAttempt);
  const current = useRef(attempt);
  const [requestPending, setRequestPending] = useState(false);
  const [requestError, setRequestError] = useState("");

  const updateAttempt = useCallback((patch: Partial<UpgradeAttempt>) => {
    if (!current.current) return false;
    const next = { ...current.current, ...patch };
    current.current = next;
    const stored = storeAttempt(next);
    setAttempt(next);
    return stored;
  }, []);

  const start = useCallback((status: ChromaUpdateStatus, observed: boolean) => {
    if (current.current) return;
    const progress = observed ? status.upgrade : null;
    const version = progress?.version ?? status.latestRelease?.version;
    if (!version) return;
    const next: UpgradeAttempt = {
      version, previousVersion: status.currentVersion, requestedAt: progress ? Date.parse(progress.startedAt) : Date.now(),
      monitoringStartedAt: Date.now(),
      previousJobStartedAt: observed ? null : status.upgrade?.startedAt ?? null,
      jobStartedAt: progress?.startedAt ?? null, accepted: observed,
      reloaded: observed && status.currentVersion === version,
    };
    current.current = next;
    storeAttempt(next);
    setRequestError("");
    setAttempt(next);
    if (observed) return;
    setRequestPending(true);
    // Submit only here, on the confirmed user action. Refresh/retry only reads status.
    void installChromaUpdate(version).then((result) => {
      if (current.current?.requestedAt !== next.requestedAt) return;
      updateAttempt({ accepted: true, jobStartedAt: result.upgrade?.version === version ? result.upgrade.startedAt : null });
    }).catch(async (error: unknown) => {
      if (current.current?.requestedAt !== next.requestedAt) return;
      // A network error or 5xx can lose an acceptance response: reconcile the job first.
      // Browsers can also retry a dropped connection themselves and receive a conflict.
      if (error instanceof ApiRequestError && error.status === 409) {
        try {
          const result = await getChromaUpdateStatus({ notifySessionExpired: false });
          if (current.current?.requestedAt !== next.requestedAt) return;
          if (result.upgrade?.version === version && result.upgrade.startedAt !== next.previousJobStartedAt) {
            updateAttempt({ accepted: true, jobStartedAt: result.upgrade.startedAt });
            return;
          }
        } catch { return; /* A failed status read leaves acceptance uncertain. */ }
      }
      if (error instanceof ApiRequestError && [400, 401, 403, 409].includes(error.status)) {
        storeAttempt(null);
        setRequestError(error.status === 401 ? "Your session expired before the upgrade was accepted. Sign in and try again." : error.message);
      }
    }).finally(() => {
      if (current.current?.requestedAt === next.requestedAt) setRequestPending(false);
    });
  }, [updateAttempt]);

  const beginUpgrade = useCallback((status: ChromaUpdateStatus) => start(status, false), [start]);
  const observeUpgrade = useCallback((status: ChromaUpdateStatus) => {
    if (status.upgrade?.state === "installing") start(status, true);
  }, [start]);
  const clearUpgrade = useCallback(() => {
    current.current = null;
    storeAttempt(null);
    setAttempt(null);
    setRequestPending(false);
    setRequestError("");
  }, []);

  return { attempt, requestPending, requestError, beginUpgrade, observeUpgrade, updateAttempt, clearUpgrade };
}
