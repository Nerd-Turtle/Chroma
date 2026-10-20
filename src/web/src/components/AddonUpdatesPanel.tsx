import { useEffect, useRef, useState } from "react";
import type { AddonUpdateSummary } from "../../../shared/types/index.js";
import { checkAddonLibraryUpdates, getAddonUpdateSummary, retryInstanceAddonUpdate } from "../api/chromaApi.js";

export default function AddonUpdatesPanel({ instanceId, onLibraryChanged, onUpdatesApplied }: { instanceId?: string; onLibraryChanged?: () => void; onUpdatesApplied?: () => void }) {
  const [summary, setSummary] = useState<AddonUpdateSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmRetry, setConfirmRetry] = useState("");
  const appliedVersions = useRef<string | null>(null);
  const appliedCallback = useRef(onUpdatesApplied);
  appliedCallback.current = onUpdatesApplied;
  useEffect(() => {
    if (!summary) return;
    const versions = JSON.stringify(summary.updates.filter((update) => update.state === "succeeded" && (!instanceId || update.instanceId === instanceId)).map((update) => [update.addonId, update.targetFileId]));
    if (appliedVersions.current !== null && appliedVersions.current !== versions) appliedCallback.current?.();
    appliedVersions.current = versions;
  }, [summary, instanceId]);
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try { const result = await getAddonUpdateSummary(); if (active) { setSummary(result); setError(""); } }
      catch (failure) { if (active) setError(failure instanceof Error ? failure.message : "Unable to read addon updates."); }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 15_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [instanceId]);
  async function perform(operation: () => Promise<AddonUpdateSummary>) {
    setBusy(true); setError("");
    try { setSummary(await operation()); setConfirmRetry(""); onLibraryChanged?.(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Addon update failed."); }
    finally { setBusy(false); }
  }
  const updates = summary?.updates.filter((update) => !instanceId || update.instanceId === instanceId) ?? [];
  const checks = summary?.checks.filter((check) => check.state === "error" || check.state === "review" || check.state === "downloaded") ?? [];
  return <section className="addon-update-panel" aria-label="Addon update status">
    <div className="addon-update-panel-header">
      <div><strong>{instanceId ? "Scheduled addon updates" : "Library updates"}</strong>
        <p className="muted-copy">{instanceId ? "Opted-in addons use this instance's update schedule. Running instances wait until stopped." : "Stable releases download once. Each opted-in instance adopts compatible versions on its own update schedule."}</p>
        {!instanceId && summary?.lastCheckedAt ? <small>Last library check: {new Date(summary.lastCheckedAt).toLocaleString()}</small> : null}
      </div>
      {!instanceId ? <button type="button" className="secondary-button" disabled={busy} onClick={() => void perform(checkAddonLibraryUpdates)}>{busy ? "Checking…" : "Check and download updates"}</button> : null}
    </div>
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    {!instanceId && summary?.checkError ? <p className="form-error" role="alert">{summary.checkError}</p> : null}
    {!instanceId ? checks.map((check) => <p key={check.projectId} className="muted-copy"><strong>{check.name}:</strong> {check.message}</p>) : null}
    {updates.length ? <ul className="addon-update-status-list">{updates.map((update) => <li key={update.addonId}>
      <strong>{update.addonName}{!instanceId ? ` · ${update.instanceName}` : ""}</strong>
      <span>{update.previousVersion} → {update.targetVersion}</span>
      <span role="status">{update.state === "review" ? "Review needed" : update.state}: {update.message}</span>
      {update.state === "failed" ? <div>{confirmRetry === update.addonId ? <>
        <p>Retry this addon update? Chroma will back up the instance and wait until it is stopped.</p>
        <button type="button" className="secondary-button" disabled={busy} onClick={() => void perform(() => retryInstanceAddonUpdate(update.instanceId, update.addonId))}>Confirm retry</button>
        <button type="button" className="secondary-button" disabled={busy} onClick={() => setConfirmRetry("")}>Cancel</button>
      </> : <button type="button" className="secondary-button" disabled={busy} onClick={() => setConfirmRetry(update.addonId)}>Retry update</button>}</div> : null}
    </li>)}</ul> : <p className="muted-copy">No scheduled addon updates are pending.</p>}
  </section>;
}
