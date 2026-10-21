import { useEffect, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, RefreshCw } from "lucide-react";
import { CHROMA_UPGRADE_TIMEOUT_MS } from "../../../shared/chromaUpdates.js";
import { ApiRequestError, getChromaReadiness, getChromaUpdateStatus, getSession } from "../api/chromaApi.js";
import LoginPage from "../pages/LoginPage.js";
import type { UpgradeAttempt } from "./useChromaUpgrade.js";

type Phase = "starting" | "checking" | "installing" | "reconnecting" | "verifying" | "signin" | "succeeded" | "failed" | "unknown" | "reload";
const MESSAGES: Record<Phase, string> = {
  starting: "Starting the upgrade. Waiting for Chroma to accept the request…",
  checking: "Checking whether the upgrade started…",
  installing: "Installing the update. Chroma will restart automatically.",
  reconnecting: "Connection interrupted. Chroma may be restarting. Reconnecting automatically…",
  verifying: "Chroma is back. Verifying the installed version and upgrade result…",
  signin: "Chroma is available. Sign in to finish checking the upgrade.",
  succeeded: "The new version is running and the updater confirmed its health check passed.",
  failed: "The upgrade needs attention.",
  unknown: "Unable to confirm completion. The upgrade may still be running. Retry the connection or check Chroma’s service logs.",
  reload: "Chroma is back. Reload this page to load the updated interface.",
};

type Props = {
  attempt: UpgradeAttempt;
  requestPending: boolean;
  requestError: string;
  updateAttempt: (patch: Partial<UpgradeAttempt>) => boolean;
  onFinish: () => void;
};

const ChromaUpgradeScreen = ({ attempt, requestPending, requestError, updateAttempt, onFinish }: Props) => {
  const [phase, setPhase] = useState<Phase>(requestPending ? "starting" : "checking");
  const [detail, setDetail] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [lastContact, setLastContact] = useState<number | null>(null);
  const [retry, setRetry] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const latest = useRef({ attempt, requestPending });
  latest.current = { attempt, requestPending };

  useEffect(() => { heading.current?.focus(); }, []);
  useEffect(() => {
    const tick = () => setElapsed(Math.max(0, Math.floor((Date.now() - attempt.requestedAt) / 1_000)));
    tick();
    if (phase === "succeeded") return;
    const timer = window.setInterval(tick, 1_000);
    return () => window.clearInterval(timer);
  }, [attempt.requestedAt, phase]);

  useEffect(() => {
    if (requestError) { setDetail(requestError); setPhase("failed"); return; }
    const controller = new AbortController();
    let disposed = false;
    let timer: number | undefined;
    let failures = 0;
    // Persist the monitoring window too, so a retry survives the recovery reload.
    const deadline = attempt.monitoringStartedAt + CHROMA_UPGRADE_TIMEOUT_MS;
    async function poll() {
      if (disposed) return;
      if (Date.now() > deadline) { setPhase("unknown"); return; }
      let keepPolling = true;
      try {
        const readiness = await getChromaReadiness(controller.signal);
        if (disposed) return;
        setLastContact(Date.now());
        const current = latest.current.attempt;
        if (readiness.version === current.version && !current.reloaded && current.previousVersion !== current.version) {
          // Save BEFORE reloading: the updated client resumes once, including after expiry.
          if (updateAttempt({ reloaded: true })) window.location.reload();
          else setPhase("reload");
          return;
        }
        const session = await getSession(controller.signal, false);
        if (disposed) return;
        if (!session.authenticated) setPhase("signin");
        else {
          const status = await getChromaUpdateStatus({ signal: controller.signal, notifySessionExpired: false });
          if (disposed) return;
          const progress = status.upgrade;
          const matches = progress?.version === current.version && progress.startedAt !== current.previousJobStartedAt &&
            (current.jobStartedAt === null || progress.startedAt === current.jobStartedAt);
          if (matches && progress) {
            if (!current.accepted || current.jobStartedAt === null) updateAttempt({ accepted: true, jobStartedAt: progress.startedAt });
            if (progress.state === "failed") {
              setDetail(progress.message);
              setPhase("failed");
              keepPolling = false;
            } else if (progress.state === "succeeded") {
              if (status.currentVersion === current.version && readiness.version === current.version) setPhase("succeeded");
              else { setDetail("The updater reported completion, but the expected version is not running. Retry the connection or check Chroma’s service logs."); setPhase("unknown"); }
              keepPolling = false;
            } else setPhase(readiness.version === current.version ? "verifying" : "installing");
          } else if (current.accepted) {
            setPhase(readiness.version === current.version ? "verifying" : "installing");
          } else setPhase(latest.current.requestPending ? "starting" : "checking");
        }
        failures = 0;
      } catch (error) {
        if (disposed) return;
        if (error instanceof ApiRequestError && error.status === 401) setPhase("signin");
        else if (error instanceof ApiRequestError && error.status === 403) {
          setDetail("Administrator access is required to verify this upgrade. Sign in with an administrator account.");
          setPhase("failed");
          keepPolling = false;
        } else { failures++; setPhase("reconnecting"); }
      }
      if (!disposed && keepPolling) timer = window.setTimeout(() => { void poll(); }, Math.min(10_000, 2_000 * 2 ** Math.min(failures, 3)));
    }
    void poll();
    return () => { disposed = true; controller.abort(); window.clearTimeout(timer); };
  }, [attempt.requestedAt, attempt.monitoringStartedAt, attempt.version, attempt.previousVersion, attempt.reloaded, requestError, retry, updateAttempt]);

  const busy = ["starting", "checking", "installing", "reconnecting", "verifying"].includes(phase);
  const title = phase === "succeeded" ? "Upgrade complete" : phase === "failed" || phase === "unknown" ? "Upgrade needs attention" : `Upgrading Chroma to ${attempt.version}`;
  const duration = `${Math.floor(elapsed / 60)}m ${String(elapsed % 60).padStart(2, "0")}s`;

  return (
    <main className="upgrade-screen">
      <section className="upgrade-card" aria-labelledby="upgrade-heading">
        <div className="upgrade-brand"><img src="/Chroma-logo.png" alt="" /> Chroma Server Manager</div>
        <div className={`upgrade-symbol upgrade-symbol-${phase}`} aria-hidden="true">
          {phase === "succeeded" ? <CheckCircle2 /> : phase === "failed" || phase === "unknown" ? <AlertCircle /> : <RefreshCw className={busy ? "upgrade-spin" : ""} />}
        </div>
        <p className="upgrade-eyebrow">APPLICATION UPDATE</p>
        <h1 id="upgrade-heading" ref={heading} tabIndex={-1}>{title}</h1>
        <p className="upgrade-version">{attempt.previousVersion !== attempt.version ? `${attempt.previousVersion} → ` : "Version "}{attempt.version}</p>
        <p className="upgrade-status" role="status" aria-live="polite" aria-atomic="true">{phase === "failed" || (phase === "unknown" && detail) ? detail || MESSAGES[phase] : MESSAGES[phase]}</p>
        {busy ? <div className="upgrade-progress" role="progressbar" aria-label="Chroma upgrade in progress"><span /></div> : null}
        <dl className="upgrade-timing">
          <div><dt>Elapsed</dt><dd>{duration}</dd></div>
          <div><dt>Last connected</dt><dd>{lastContact ? new Date(lastContact).toLocaleTimeString() : "Waiting for Chroma"}</dd></div>
        </dl>
        {busy ? <p className="muted-copy">You can leave this tab open. Chroma will reconnect automatically. Refreshing this page resumes the status check.</p> : null}
        {busy && elapsed >= 60 ? <p className="muted-copy">This is taking a little longer. Downloads and startup time can vary; the connection is still being checked.</p> : null}
        {phase === "signin" ? <LoginPage onLoginSuccess={() => { setPhase("verifying"); setRetry((value) => value + 1); }} /> : null}
        <div className="upgrade-actions">
          {phase === "succeeded" ? <button type="button" className="primary-button" onClick={onFinish}>Continue to Settings</button> : null}
          {phase === "unknown" || (phase === "failed" && !requestError) ? <button type="button" className="primary-button" onClick={() => { setDetail(""); setPhase("checking"); updateAttempt({ monitoringStartedAt: Date.now() }); setRetry((value) => value + 1); }}>Retry connection</button> : null}
          {phase === "failed" ? <button type="button" className="secondary-button" onClick={onFinish}>Return to Chroma</button> : null}
          {phase === "reload" ? <button type="button" className="primary-button" onClick={() => window.location.reload()}>Reload interface</button> : null}
        </div>
      </section>
    </main>
  );
};

export default ChromaUpgradeScreen;
