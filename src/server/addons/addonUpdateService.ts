import type { Database } from "better-sqlite3";
import type { FastifyBaseLogger } from "fastify";
import { existsSync } from "node:fs";
import type { AddonLibraryUpdateCheck, AddonReleaseChannel, AddonUpdateSummary, Instance } from "../../shared/types/index.js";
import { getAppSetting, upsertAppSetting } from "../setup/appSettingsRepository.js";
import { getAppSettings, getCurseForgeApiKey, isSetupComplete } from "../setup/setupService.js";
import { getInstance, listInstances } from "../instances/instanceService.js";
import { getBdsRuntimeState } from "../bds/bdsRuntimeService.js";
import { isUpdateScheduleDue } from "../utils/updateSchedule.js";
import { getAddonUpdateSettings } from "./addonUpdateSettingsService.js";
import { CurseForgeClient, type CurseForgeModFile } from "./curseForgeClient.js";
import { downloadCurseForgeAddonToLibrary } from "./addonService.js";
import { getAddonFile, listAddonFiles, listInstanceAddons } from "./addonRepository.js";
import { getAddonUpdateCompatibilityIssue } from "./addonUpdateCompatibility.js";
import { getAddonUpdateJobs, saveAddonUpdateJob, setAddonUpdateJobState } from "./addonUpdateRepository.js";
import { applyInstanceAddonUpdate, recoverInstanceAddonUpdate } from "./addonInstanceUpdateService.js";
import { isAllowedAddonRelease } from "./addonReleasePolicy.js";
import { assertNoAddonUpdateInProgress, getAddonUpdateJournalPath } from "../instances/addonUpdateControl.js";

const LIBRARY_CHECK_KEY = "addons.updates.last_check";
type LibraryCheck = { checkedAt: string | null; error: string | null; checks: AddonLibraryUpdateCheck[]; releaseChannel?: AddonReleaseChannel };

export class AddonUpdateService {
  private checking: Promise<AddonUpdateSummary> | null = null;
  private timer: NodeJS.Timeout | null = null;
  private scheduledWork: Promise<void> | null = null;
  constructor(private readonly db: Database, private readonly options: { now?: () => Date; listProviderFiles?: (projectId: number) => Promise<CurseForgeModFile[]>; downloadRelease?: typeof downloadCurseForgeAddonToLibrary } = {}) {}
  private now(): Date { return this.options.now?.() ?? new Date(); }
  private lastCheck(): LibraryCheck {
    const stored = getAppSetting(this.db, LIBRARY_CHECK_KEY);
    return stored ? JSON.parse(stored) as LibraryCheck : { checkedAt: null, error: null, checks: [] };
  }

  getSummary(): AddonUpdateSummary {
    const check = this.lastCheck();
    const instances = new Map(listInstances(this.db).map((instance) => [instance.id, instance]));
    const updates = getAddonUpdateJobs(this.db).flatMap((job) => {
      const instance = instances.get(job.instance_id);
      const addon = instance ? listInstanceAddons(this.db, instance.id).find((item) => item.id === job.addon_id) : null;
      if (!instance || !addon) return [];
      const target = getAddonFile(this.db, job.target_file_id);
      const previous = job.previous_file_id ? getAddonFile(this.db, job.previous_file_id) : null;
      return [{ instanceId: instance.id, instanceName: instance.friendlyName, addonId: addon.id, addonName: addon.name,
        targetFileId: job.target_file_id, previousVersion: previous?.fileDisplayName ?? previous?.fileName ?? "Previous version",
        targetVersion: target?.fileDisplayName ?? target?.fileName ?? "Unavailable release", state: job.state, message: job.message, updatedAt: job.updated_at }];
    });
    return { lastCheckedAt: check.checkedAt, checkError: check.error, checks: check.checks, updates };
  }

  async checkLibrary(): Promise<AddonUpdateSummary> {
    if (this.checking) return this.checking;
    const previous = this.lastCheck();
    const { releaseChannel } = getAddonUpdateSettings(this.db);
    if ((previous.releaseChannel ?? "stable") === releaseChannel && previous.checkedAt && this.now().getTime() - Date.parse(previous.checkedAt) < 60_000) return this.getSummary();
    this.checking = this.performLibraryCheck().finally(() => { this.checking = null; });
    return this.checking;
  }

  private async performLibraryCheck(): Promise<AddonUpdateSummary> {
    const checkedAt = this.now().toISOString();
    const result: LibraryCheck = { checkedAt, error: null, checks: [] };
    try {
      const { releaseChannel } = getAddonUpdateSettings(this.db);
      result.releaseChannel = releaseChannel;
      const projects = new Map(listAddonFiles(this.db).filter((file) => file.provider === "curseforge").map((file) => [file.providerProjectId, file]));
      const key = getCurseForgeApiKey(this.db);
      if (projects.size && !this.options.listProviderFiles && !key) throw new Error("Configure the CurseForge API key to check downloaded addons for updates.");
      const client = key ? new CurseForgeClient(key) : null;
      for (const [projectId, installed] of projects) {
        try {
          if (!/^\d+$/.test(projectId) || !Number.isSafeInteger(Number(projectId))) throw new Error("The provider project identifier is invalid.");
          const files = this.options.listProviderFiles ? await this.options.listProviderFiles(Number(projectId)) : await client!.getModFiles(Number(projectId));
          const candidate = files.filter((file) => isAllowedAddonRelease(file, releaseChannel) && /\.(mcaddon|mcpack|zip)$/i.test(file.fileName) && Number.isFinite(Date.parse(file.fileDate)))
            .sort((a, b) => Date.parse(b.fileDate) - Date.parse(a.fileDate) || b.id - a.id)[0];
          if (!candidate) {
            result.checks.push({ projectId, name: installed.name, state: "review", message: "Automatic update skipped: no available Bedrock release matches the selected release channel.", checkedAt });
            continue;
          }
          const known = listAddonFiles(this.db).find((file) => file.provider === "curseforge" && file.providerProjectId === projectId && file.providerFileId === String(candidate.id) && !file.error);
          const downloaded = known ?? (await (this.options.downloadRelease ?? downloadCurseForgeAddonToLibrary)(this.db, { projectId: Number(projectId), fileId: candidate.id, releaseChannel })).addon;
          result.checks.push({ projectId, name: installed.name, state: downloaded.error ? "review" : known ? "current" : "downloaded", message: downloaded.error ?? (known ? "The latest allowed release is already in the library." : "An allowed release was downloaded. Instances adopt it on their own update schedules."), checkedAt });
        } catch (error) {
          result.checks.push({ projectId, name: installed.name, state: "error", message: error instanceof Error ? error.message : "Addon update check failed.", checkedAt });
        }
      }
    } catch (error) { result.error = error instanceof Error ? error.message : "Addon update check failed."; }
    upsertAppSetting(this.db, LIBRARY_CHECK_KEY, JSON.stringify(result), checkedAt);
    return this.getSummary();
  }

  queueInstanceUpdates(instance: Instance): void {
    if (!instance.automaticUpdatesEnabled) return;
    const library = listAddonFiles(this.db);
    for (const addon of listInstanceAddons(this.db, instance.id)) {
      if (!addon.autoUpdateEnabled || addon.provider !== "curseforge" || addon.librarySyncStatus !== "linked" || !addon.addonFileId || addon.status === "error") continue;
      const candidates = library.filter((file) => file.provider === addon.provider && file.providerProjectId === addon.providerProjectId && file.id !== addon.addonFileId && !file.error && file.fileDate && addon.fileDate && Date.parse(file.fileDate) > Date.parse(addon.fileDate))
        .sort((a, b) => Date.parse(b.fileDate!) - Date.parse(a.fileDate!));
      let target = candidates[0];
      if (!target) continue;
      // Prefer the newest eligible downloaded version; retain newer incompatible ones for review.
      let issue: string | null;
      try {
        target = candidates.find((file) => !getAddonUpdateCompatibilityIssue(this.db, instance, addon, file.id)) ?? target;
        issue = getAddonUpdateCompatibilityIssue(this.db, instance, addon, target.id);
      } catch (error) {
        issue = error instanceof Error ? error.message : "Unable to validate this addon release. Review it manually.";
      }
      const previous = getAddonUpdateJobs(this.db, instance.id).find((job) => job.addon_id === addon.id);
      // An in-flight update owns its target until it commits or rolls back.
      if (previous?.state === "applying" || (previous?.target_file_id === target.id && previous.state === "failed")) continue;
      saveAddonUpdateJob(this.db, { addon_id: addon.id, instance_id: instance.id, target_file_id: target.id, previous_file_id: addon.addonFileId,
        state: issue ? "review" : "pending", message: issue ?? "Waiting for this instance to be stopped and idle.", updated_at: this.now().toISOString() });
    }
  }

  async processInstance(instanceId: string): Promise<void> {
    const instance = getInstance(this.db, instanceId);
    if (!instance) return;
    for (const job of getAddonUpdateJobs(this.db, instanceId).filter((item) => item.state === "pending")) {
      // An unfinished recovery still owns the shared world/configuration files.
      if (existsSync(getAddonUpdateJournalPath(instance))) return;
      try { assertNoAddonUpdateInProgress(instance); }
      catch { return; }
      const addon = listInstanceAddons(this.db, instanceId).find((item) => item.id === job.addon_id);
      if (!instance.automaticUpdatesEnabled || !addon?.autoUpdateEnabled || addon.addonFileId !== job.previous_file_id) {
        this.db.prepare("DELETE FROM addon_instance_updates WHERE addon_id=?").run(job.addon_id);
        continue;
      }
      const runtime = await getBdsRuntimeState(this.db, instanceId);
      if (runtime.isProcessActive || runtime.status !== "stopped" || runtime.maintenanceStatus !== "idle") return;
      try {
        await applyInstanceAddonUpdate(this.db, job);
      } catch (error) {
        // The application service records rollback failures with recovery details.
        // Keep that message, and continue with other addons once the instance is idle.
        const recorded = getAddonUpdateJobs(this.db, instanceId).find((item) => item.addon_id === job.addon_id);
        if (recorded?.state !== "failed") {
          setAddonUpdateJobState(this.db, job.addon_id, "failed", error instanceof Error ? error.message : "Addon update failed. Retry manually.");
        }
      }
    }
  }

  async retry(instanceId: string, addonId: string): Promise<AddonUpdateSummary> {
    const instance = getInstance(this.db, instanceId);
    if (!instance) throw new Error("Instance not found");
    const job = getAddonUpdateJobs(this.db, instanceId).find((item) => item.addon_id === addonId);
    if (!job || job.state !== "failed") throw new Error("No failed addon update is available to retry.");
    await recoverInstanceAddonUpdate(this.db, instance);
    if (getAddonUpdateJobs(this.db, instanceId).find((item) => item.addon_id === addonId)?.state === "succeeded") return this.getSummary();
    setAddonUpdateJobState(this.db, addonId, "pending", "Retry requested. Waiting for the instance to be stopped and idle.");
    await this.processInstance(instanceId);
    return this.getSummary();
  }

  async recoverInterruptedUpdates(logger?: FastifyBaseLogger): Promise<void> {
    for (const instance of listInstances(this.db)) {
      try { await recoverInstanceAddonUpdate(this.db, instance); }
      catch (error) { logger?.error({ error, instanceId: instance.id }, "Addon recovery requires attention"); }
    }
  }

  async runScheduledWork(): Promise<void> {
    if (this.scheduledWork) return this.scheduledWork;
    if (!isSetupComplete(this.db)) return;
    this.scheduledWork = this.performScheduledWork().finally(() => { this.scheduledWork = null; });
    return this.scheduledWork;
  }

  private async performScheduledWork(): Promise<void> {
    const settings = getAddonUpdateSettings(this.db);
    if (settings.automaticChecksEnabled && isUpdateScheduleDue(settings, this.lastCheck().checkedAt, getAppSettings(this.db)?.timezone ?? "UTC", this.now())) await this.checkLibrary();
    // A manual check may already be downloading the release an instance needs.
    await this.checking;
    for (const instance of listInstances(this.db)) {
      try { await this.processInstance(instance.id); }
      catch { /* Per-instance failures are durable and visible; other instances can still update. */ }
    }
  }

  startScheduler(logger: FastifyBaseLogger): void {
    if (this.timer) return;
    const tick = () => { void this.runScheduledWork().catch((error: unknown) => logger.error({ error }, "Addon update scheduler failed")); };
    this.timer = setInterval(tick, 60_000);
    this.timer.unref();
    tick();
  }
  stopScheduler(): void { if (this.timer) clearInterval(this.timer); this.timer = null; }
}
