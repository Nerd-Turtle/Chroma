import { useEffect, useState, type FormEvent } from "react";
import type { ChromaUpdateSettings, ChromaUpdateStatus } from "../../../shared/types/index.js";
import { checkChromaUpdates, getChromaUpdateStatus, saveChromaUpdateSettings } from "../api/chromaApi.js";

type Props = { onInstall: (status: ChromaUpdateStatus) => void; onUpgradeDetected: (status: ChromaUpdateStatus) => void };

const ChromaUpdatesSection = ({ onInstall, onUpgradeDetected }: Props) => {
  const [status, setStatus] = useState<ChromaUpdateStatus | null>(null);
  const [preferences, setPreferences] = useState<ChromaUpdateSettings | null>(null);
  const [action, setAction] = useState<"save" | "check" | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [disconnected, setDisconnected] = useState(false);
  const [confirmInstall, setConfirmInstall] = useState(false);

  useEffect(() => {
    let disposed = false;
    async function refresh() {
      try {
        const result = await getChromaUpdateStatus();
        if (disposed) return;
        setStatus(result);
        onUpgradeDetected(result);
        setPreferences((current) => current ?? result.settings);
        setError((current) => current === "Unable to load Chroma updates." ? "" : current);
        setDisconnected(false);
      } catch {
        if (disposed) return;
        setDisconnected(true);
        setError("Unable to load Chroma updates.");
      }
    }
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 5_000);
    return () => { disposed = true; window.clearInterval(timer); };
  }, [onUpgradeDetected]);

  async function perform(nextAction: "save" | "check", request: () => Promise<ChromaUpdateStatus>) {
    setAction(nextAction);
    setError("");
    setSuccess("");
    try {
      const result = await request();
      setStatus(result);
      onUpgradeDetected(result);
      if (nextAction === "save") {
        setPreferences(result.settings);
        setSuccess("Chroma update settings saved.");
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to update Chroma.");
    } finally { setAction(null); }
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (preferences) void perform("save", () => saveChromaUpdateSettings(preferences));
  }

  const installing = status?.upgrade?.state === "installing";
  const canInstall = Boolean(status?.updateAvailable && status.latestRelease?.compatible && status.installationSupported && status.busyInstanceCount === 0 && !installing && !action);

  return (
    <section className="settings-section settings-updates-section">
      <header className="settings-section-header settings-certificate-header">
        <div>
          <h2>Chroma Updates</h2>
          <p className="muted-copy">Check GitHub for stable Chroma releases. Minecraft and addon updates are managed separately.</p>
        </div>
        <button type="button" className="secondary-button" disabled={action !== null || installing} onClick={() => void perform("check", checkChromaUpdates)}>
          {action === "check" ? "Checking..." : "Check for updates"}
        </button>
      </header>

      {error && !installing ? <div className="form-error" role="alert">{error}</div> : null}
      {success ? <p role="status">{success}</p> : null}
      {status?.checkError ? <div className="form-error">{status.checkError}</div> : null}
      {status?.automaticInstallError ? <div className="form-error" role="alert">{status.automaticInstallError}</div> : null}
      {installing ? <p role="status">{disconnected ? "Chroma is restarting. Reconnecting automatically..." : status.upgrade?.message}</p> : null}
      {status?.upgrade && !installing ? <p role="status">{status.upgrade.message}</p> : null}

      {status && preferences ? (
        <div className="settings-update-grid">
          <form className="form-grid" onSubmit={save}>
            <label className="settings-update-checkbox">
              <input type="checkbox" checked={preferences.automaticChecksEnabled} disabled={action !== null || installing}
                onChange={(event) => setPreferences({ ...preferences, automaticChecksEnabled: event.target.checked })} />
              Check for Chroma updates automatically
            </label>
            <label>
              Check every
              <select value={preferences.checkIntervalHours} disabled={action !== null || installing || !preferences.automaticChecksEnabled}
                onChange={(event) => setPreferences({ ...preferences, checkIntervalHours: Number(event.target.value) as ChromaUpdateSettings["checkIntervalHours"] })}>
                <option value={6}>6 hours</option><option value={12}>12 hours</option><option value={24}>24 hours</option>
              </select>
            </label>
            <label>
              When an update is available
              <select value={preferences.mode} disabled={action !== null || installing}
                onChange={(event) => setPreferences({ ...preferences, mode: event.target.value as ChromaUpdateSettings["mode"] })}>
                <option value="notify">Notify only (default)</option>
                <option value="install">Install automatically when all instances are stopped</option>
              </select>
            </label>
            <p className="muted-copy">Automatic installation waits for all instances and their maintenance tasks to stop. Chroma restarts after installing.</p>
            <button type="submit" className="primary-button" disabled={action !== null || installing}>
              {action === "save" ? "Saving..." : "Save update settings"}
            </button>
          </form>

          <div className="settings-section">
            <dl className="certificate-summary">
              <div><dt>Installed version</dt><dd>{status.currentVersion}</dd></div>
              <div><dt>Latest stable release</dt><dd>{status.latestRelease?.version ?? (status.lastCheckedAt && !status.checkError ? "No published stable releases" : "Not checked yet")}</dd></div>
              <div><dt>Last checked</dt><dd>{status.lastCheckedAt ? new Date(status.lastCheckedAt).toLocaleString() : "Never"}</dd></div>
            </dl>
            {status.latestRelease ? <a className="addon-title-link" href={status.latestRelease.url} target="_blank" rel="noreferrer">Read release notes</a> : null}
            {status.updateAvailable ? <p role="status">Chroma {status.latestRelease?.version} is available.</p> : status.latestRelease ? <p>Chroma is up to date.</p> : null}
            {status.installationUnavailableReason ? <p className="muted-copy">{status.installationUnavailableReason}</p> : null}
            {status.updateAvailable && !status.latestRelease?.compatible ? <p className="muted-copy">This release does not have the archive and checksum needed for this Ubuntu version.</p> : null}
            {status.busyInstanceCount > 0 && (status.updateAvailable || status.settings.mode === "install") ? <p role="status">Waiting for {status.busyInstanceCount} running or busy instance(s) to stop before upgrading.</p> : null}
            {status.updateAvailable ? (
              <div className="settings-update-actions">
                {confirmInstall ? (
                  <>
                    <p>Install Chroma {status.latestRelease?.version} now? Chroma will restart. The installer backs up the database and retains the previous application release.</p>
                    <button type="button" className="primary-button" disabled={!canInstall}
                      onClick={() => onInstall(status)}>Confirm upgrade</button>
                    <button type="button" className="secondary-button" disabled={action !== null} onClick={() => setConfirmInstall(false)}>Cancel</button>
                  </>
                ) : <button type="button" className="primary-button" disabled={!canInstall} onClick={() => setConfirmInstall(true)}>Install update</button>}
              </div>
            ) : null}
          </div>
        </div>
      ) : !error ? <p className="muted-copy">Loading Chroma update settings...</p> : null}
    </section>
  );
};

export default ChromaUpdatesSection;
