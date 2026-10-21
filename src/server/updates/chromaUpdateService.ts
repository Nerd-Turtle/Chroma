import type { Database } from "better-sqlite3";
import type { FastifyBaseLogger } from "fastify";
import { lstatSync } from "node:fs";
import { createConnection } from "node:net";
import { join } from "node:path";
import type { ChromaReadiness, ChromaRelease, ChromaUpdateSettings, ChromaUpdateStatus } from "../../shared/types/index.js";
import { getBdsRuntimeState } from "../bds/bdsRuntimeService.js";
import { listInstances } from "../instances/instanceRepository.js";
import { getAppSetting, upsertAppSetting } from "../setup/appSettingsRepository.js";
import { isSetupComplete } from "../setup/setupService.js";
import { fetchLatestChromaRelease, getInstalledChromaVersion, getUbuntuReleasePlatform, isNewerVersion, isStableVersion } from "./githubReleaseService.js";
import { getChromaUpdateDirectory, readChromaUpgradeProgress, setChromaUpgradeRequestPending } from "./updateControl.js";
import { isInstanceMutationInProgress } from "../instances/addonUpdateControl.js";

const SETTINGS_KEY = "app.chroma_updates.settings";
const CHECK_KEY = "app.chroma_updates.check";
const AUTOMATIC_ATTEMPT_KEY = "app.chroma_updates.automatic_attempt_version";
const DEFAULT_SETTINGS: ChromaUpdateSettings = { automaticChecksEnabled: true, mode: "notify", checkIntervalHours: 24 };

type CheckState = { checkedAt: string | null; release: ChromaRelease | null; error: string | null; etag: string | null };
type AutomaticAttempt = { version: string; error: string | null };
type ServiceOptions = {
  fetch?: typeof fetch;
  platform?: string | null;
  currentVersion?: string;
  directory?: string;
  installationSupported?: boolean;
  requestInstall?: (version: string) => Promise<void>;
  getBusyInstanceCount?: () => Promise<number>;
  now?: () => Date;
};

export function validateChromaUpdateSettings(input: unknown): ChromaUpdateSettings {
  if (!input || typeof input !== "object") throw new Error("Update settings are required.");
  const value = input as Partial<ChromaUpdateSettings>;
  if (typeof value.automaticChecksEnabled !== "boolean" || (value.mode !== "notify" && value.mode !== "install") ||
      ![6, 12, 24].includes(value.checkIntervalHours as number)) {
    throw new Error("Choose whether to check automatically, notify or install, and a check interval of 6, 12, or 24 hours.");
  }
  return { automaticChecksEnabled: value.automaticChecksEnabled, mode: value.mode, checkIntervalHours: value.checkIntervalHours! };
}

export async function requestChromaUpgrade(socketPath: string, version: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const socket = createConnection(socketPath);
    let response = "";
    socket.setTimeout(20_000);
    socket.once("connect", () => socket.write(`${JSON.stringify({ version })}\n`));
    socket.on("data", (data: Buffer) => {
      response += data.toString("utf8");
      if (response.length > 4096) { socket.destroy(new Error("Invalid updater response.")); return; }
      if (!response.includes("\n")) return;
      try {
        const result = JSON.parse(response.split("\n", 1)[0]!) as { accepted?: boolean; error?: string };
        if (result.accepted !== true) reject(new Error(result.error ?? "The updater declined the upgrade."));
        else resolve();
      } catch { reject(new Error("Invalid updater response.")); }
      socket.destroy();
    });
    socket.once("timeout", () => socket.destroy(new Error("The updater did not respond. Check its service logs before retrying.")));
    socket.once("error", reject);
    socket.once("end", () => reject(new Error("The updater connection closed before accepting the upgrade.")));
  });
}

export class ChromaUpdateService {
  private checkInProgress: Promise<void> | null = null;
  private requestInProgress = false;
  private timer: NodeJS.Timeout | null = null;
  private schedulerBusy = false;
  private readonly directory: string;

  constructor(private readonly db: Database, private readonly options: ServiceOptions = {}) {
    this.directory = options.directory ?? getChromaUpdateDirectory();
  }

  getSettings(): ChromaUpdateSettings {
    const stored = getAppSetting(this.db, SETTINGS_KEY);
    if (!stored) return { ...DEFAULT_SETTINGS };
    return validateChromaUpdateSettings(JSON.parse(stored));
  }

  async getReadiness(): Promise<ChromaReadiness> {
    return { status: "ok", version: this.options.currentVersion ?? await getInstalledChromaVersion() };
  }

  saveSettings(input: unknown): ChromaUpdateSettings {
    const settings = validateChromaUpdateSettings(input);
    upsertAppSetting(this.db, SETTINGS_KEY, JSON.stringify(settings), this.now().toISOString());
    return settings;
  }

  private now(): Date { return this.options.now?.() ?? new Date(); }

  private getCheck(): CheckState {
    const stored = getAppSetting(this.db, CHECK_KEY);
    return stored ? JSON.parse(stored) as CheckState : { checkedAt: null, release: null, error: null, etag: null };
  }

  private getAutomaticAttempt(): AutomaticAttempt | null {
    const stored = getAppSetting(this.db, AUTOMATIC_ATTEMPT_KEY);
    return stored ? JSON.parse(stored) as AutomaticAttempt : null;
  }

  private async busyInstanceCount(): Promise<number> {
    if (this.options.getBusyInstanceCount) return this.options.getBusyInstanceCount();
    let count = 0;
    for (const instance of listInstances(this.db)) {
      const runtime = await getBdsRuntimeState(this.db, instance.id);
      if (isInstanceMutationInProgress(instance.id) || instance.status !== "stopped" || runtime.isProcessActive || runtime.status !== "stopped" || runtime.maintenanceStatus !== "idle") count++;
    }
    return count;
  }

  private updaterInstalled(): boolean {
    if (this.options.installationSupported !== undefined) return this.options.installationSupported;
    if (process.env.NODE_ENV !== "production") return false;
    try { return lstatSync(join(this.directory, "control.sock")).isSocket(); }
    catch { return false; }
  }

  async getStatus(): Promise<ChromaUpdateStatus> {
    const check = this.getCheck();
    const automaticAttempt = this.getAutomaticAttempt();
    const currentVersion = this.options.currentVersion ?? await getInstalledChromaVersion();
    const platform = this.options.platform !== undefined ? this.options.platform : await getUbuntuReleasePlatform();
    const installationSupported = platform !== null && this.updaterInstalled();
    return {
      currentVersion,
      settings: this.getSettings(),
      latestRelease: check.release,
      updateAvailable: check.release !== null && isNewerVersion(check.release.version, currentVersion),
      lastCheckedAt: check.checkedAt,
      checkError: check.error,
      automaticInstallError: automaticAttempt?.version === check.release?.version ? automaticAttempt?.error ?? null : null,
      upgrade: readChromaUpgradeProgress(this.directory),
      busyInstanceCount: await this.busyInstanceCount(),
      installationSupported,
      installationUnavailableReason: platform === null
        ? "Installing updates requires Ubuntu 24.04 or 26.04 AMD64."
        : !installationSupported ? "WebUI upgrades require a release installation with the Chroma updater service. Run the current installer once to enable it." : null,
    };
  }

  async checkForUpdates(): Promise<ChromaUpdateStatus> {
    const previous = this.getCheck();
    // One shared request and a short cooldown keep multiple browser tabs within GitHub's limits.
    if (!this.checkInProgress && (!previous.checkedAt || this.now().getTime() - Date.parse(previous.checkedAt) >= 60_000)) {
      this.checkInProgress = this.performCheck().finally(() => { this.checkInProgress = null; });
    }
    await this.checkInProgress;
    return this.getStatus();
  }

  private async performCheck(): Promise<void> {
    const previous = this.getCheck();
    const state = { ...previous, checkedAt: this.now().toISOString(), error: null as string | null };
    try {
      const platform = this.options.platform !== undefined ? this.options.platform : await getUbuntuReleasePlatform();
      const result = await fetchLatestChromaRelease(platform, {
        ...(previous.etag ? { etag: previous.etag } : {}),
        ...(this.options.fetch ? { fetch: this.options.fetch } : {}),
      });
      if (!result.unchanged) state.release = result.release ?? null;
      state.etag = result.etag ?? previous.etag;
    } catch (error) {
      state.error = error instanceof Error ? error.message : "Unable to check GitHub for updates.";
    }
    upsertAppSetting(this.db, CHECK_KEY, JSON.stringify(state), state.checkedAt);
  }

  async installUpdate(version: string): Promise<ChromaUpdateStatus> {
    if (!isStableVersion(version)) throw new Error("A stable Chroma version is required.");
    if (this.requestInProgress || readChromaUpgradeProgress(this.directory)?.state === "installing") throw new Error("A Chroma upgrade is already in progress.");
    this.requestInProgress = true;
    setChromaUpgradeRequestPending(true);
    try {
      const status = await this.getStatus();
      if (!status.installationSupported) throw new Error(status.installationUnavailableReason!);
      if (!status.updateAvailable || status.latestRelease?.version !== version) throw new Error("Check for updates again before installing this version.");
      if (!status.latestRelease.compatible) throw new Error("This release is missing the archive or checksum for this Ubuntu version.");
      if (status.busyInstanceCount > 0) throw new Error("Stop every Minecraft instance and wait for maintenance to finish before upgrading Chroma.");
      await (this.options.requestInstall?.(version) ?? requestChromaUpgrade(join(this.directory, "control.sock"), version));
      if (this.getAutomaticAttempt()?.version === version) {
        upsertAppSetting(this.db, AUTOMATIC_ATTEMPT_KEY, JSON.stringify({ version, error: null }), this.now().toISOString());
      }
      return await this.getStatus();
    } finally {
      this.requestInProgress = false;
      setChromaUpgradeRequestPending(false);
    }
  }

  async runScheduledCheck(): Promise<void> {
    if (this.schedulerBusy || !isSetupComplete(this.db)) return;
    this.schedulerBusy = true;
    try {
      const settings = this.getSettings();
      if (!settings.automaticChecksEnabled) return;
      const previous = this.getCheck();
      const due = !previous.checkedAt || this.now().getTime() - Date.parse(previous.checkedAt) >= settings.checkIntervalHours * 3_600_000;
      const status = due ? await this.checkForUpdates() : await this.getStatus();
      if (settings.mode !== "install" || status.checkError || !status.updateAvailable || !status.installationSupported ||
          !status.latestRelease?.compatible || status.busyInstanceCount > 0 || status.upgrade?.state === "installing") return;
      // Failed versions need an explicit retry; avoid an unattended failure/restart loop.
      if (status.upgrade?.state === "failed" && status.upgrade.version === status.latestRelease.version) return;
      if (this.getAutomaticAttempt()?.version === status.latestRelease.version) return;
      const version = status.latestRelease.version;
      upsertAppSetting(this.db, AUTOMATIC_ATTEMPT_KEY, JSON.stringify({ version, error: null }), this.now().toISOString());
      try { await this.installUpdate(version); }
      catch (error) {
        const message = error instanceof Error ? error.message : "Unable to start the automatic upgrade.";
        upsertAppSetting(this.db, AUTOMATIC_ATTEMPT_KEY, JSON.stringify({ version, error: `Automatic upgrade could not start: ${message} Retry manually after resolving the problem.` }), this.now().toISOString());
        throw error;
      }
    } finally { this.schedulerBusy = false; }
  }

  startScheduler(logger: FastifyBaseLogger): void {
    if (this.timer) return;
    const tick = () => { void this.runScheduledCheck().catch((error: unknown) => logger.error({ error }, "Chroma update check failed")); };
    this.timer = setInterval(tick, 60_000);
    this.timer.unref();
    tick();
  }

  stopScheduler(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
