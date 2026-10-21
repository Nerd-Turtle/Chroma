import { isJsonObject } from "../../../shared/validation.js";
import type {
  AuthUser,
  AddonUpdateSummary,
  ChromaUpdateSettings,
  ChromaUpdateStatus,
  ChromaReadiness,
  AppSettingsResponse,
  AuthSessionResponse,
  AddonLibraryDownloadResponse,
  AddonLibraryEditorResponse,
  AddonLibraryListResponse,
  AddonUpdateSettingsResponse,
  BdsStartValidationResult,
  CreateInstanceRequest,
  DashboardSummary,
  CurseForgeAddonDownloadRequest,
  CurseForgeAddonProviderStatusResponse,
  CurseForgeAddonSearchRequest,
  CurseForgeAddonSearchResponse,
  InstanceBdsCheckUpdatesResponse,
  InstanceBdsConsoleCommandRequest,
  InstanceBdsConsoleCommandResponse,
  InstanceBdsLogListResponse,
  InstanceBdsLogPageResponse,
  InstanceBdsLogTailResponse,
  InstanceBdsManualUpdateResponse,
  InstanceBdsStartBlockedResponse,
  InstanceBdsRuntimeResponse,
  InstanceAddonDetailResponse,
  InstanceAddonListResponse,
  InstanceBackupResponse,
  InstanceBackupImportResponse,
  InstanceBdsStatusResponse,
  InstanceDetailResponse,
  InstanceRuntimeEventsResponse,
  InstanceServerPropertiesResponse,
  InstanceListResponse,
  InstanceSettingsResponse,
  LatestBdsVersionResponse,
  LoginRequest,
  LoginResponse,
  GeneratePkiCsrRequest,
  GeneratePkiCsrResponse,
  InstallPkiCertificateResponse,
  PkiStatusResponse,
  SetupCompleteRequest,
  SetupStatusResponse,
  UpdateAppSettingsRequest,
  UpdateAddonLibraryLinksRequest,
  UpdateAddonUpdateSettingsRequest,
  UpdateInstanceAddonOrderRequest,
  UpdateInstanceRequest,
  UpdateInstanceServerPropertiesRequest,
} from "../../../shared/types/index.js";

export const SESSION_EXPIRED_EVENT = "chroma:session-expired";

export class ApiRequestError extends Error {
  readonly status: number;
  readonly validation: BdsStartValidationResult | undefined;

  constructor(message: string, status: number, options?: { validation: BdsStartValidationResult | undefined }) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.validation = options?.validation;
  }
}

// OWASP CSRF Prevention: all mutations, including bodyless actions and FormData,
// carry a non-simple header. The server rejects it from foreign browser origins.
async function apiFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const headers = new Headers(options.headers);
  if (!["GET", "HEAD", "OPTIONS"].includes((options.method ?? "GET").toUpperCase())) {
    headers.set("X-Chroma-Request", "1");
  }
  return fetch(url, { ...options, headers, credentials: "same-origin" });
}

async function readJson<T>(response: Response, options: { notifySessionExpired?: boolean } = {}): Promise<T> {
  if (response.status === 401 && options.notifySessionExpired !== false) {
    window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
    throw new ApiRequestError("Authentication required", 401);
  }

  const text = await response.text();

  if (text.trim() === "") {
    throw new ApiRequestError("The server returned an empty response. The API may have restarted or crashed.", response.status);
  }

  let body: T & Partial<InstanceBdsStartBlockedResponse> & { error?: string };
  try {
    const parsed: unknown = JSON.parse(text);
    if (!isJsonObject(parsed)) throw new Error("Expected an API response object");
    body = parsed as T & Partial<InstanceBdsStartBlockedResponse> & { error?: string };
  } catch {
    throw new ApiRequestError("The server returned an invalid JSON response object.", response.status);
  }

  if (!response.ok) {
    const validationMessage =
      body.validation && Array.isArray(body.validation.errors) && body.validation.errors.length > 0
        ? body.validation.errors.filter((issue) => typeof issue?.message === "string").map((issue) => issue.message).join(" ")
        : undefined;

    throw new ApiRequestError(
      validationMessage ?? (typeof body.error === "string" ? body.error : "Request failed"),
      response.status,
      { validation: body.validation },
    );
  }

  return body;
}

function sessionRequestSignal(signal?: AbortSignal): AbortSignal {
  const deadline = AbortSignal.timeout(15_000);
  return signal ? AbortSignal.any([signal, deadline]) : deadline;
}

export async function getSetupStatus(signal?: AbortSignal): Promise<SetupStatusResponse> {
  const response = await apiFetch("/api/setup/status", { signal: sessionRequestSignal(signal) });
  const result = await readJson<SetupStatusResponse>(response);
  if (typeof result.setupRequired !== "boolean") throw new ApiRequestError("Invalid setup status response", response.status);
  return result;
}

export async function completeSetup(payload: SetupCompleteRequest): Promise<{ success: true }> {
  const response = await apiFetch("/api/setup/complete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  return readJson<{ success: true }>(response);
}

export async function login(payload: LoginRequest): Promise<LoginResponse> {
  const response = await apiFetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  // Incorrect credentials belong to the login form, not session-expiry handling.
  const result = await readJson<LoginResponse>(response, { notifySessionExpired: false });
  if (result.authenticated !== true || !isAuthUser(result.user)) throw new ApiRequestError("Invalid login response", response.status);
  return result;
}

export async function logout(): Promise<void> {
  await readJson(await apiFetch("/api/auth/logout", { method: "POST" }));
}

export async function recordSessionActivity(): Promise<void> {
  await readJson(await apiFetch("/api/auth/activity", { method: "POST" }));
}

function isAuthUser(value: unknown): value is AuthUser {
  return isJsonObject(value) && typeof value.id === "string" && typeof value.username === "string" && value.role === "admin";
}

export async function getSession(signal?: AbortSignal, notifySessionExpired = true): Promise<AuthSessionResponse> {
  const response = await apiFetch("/api/auth/session", { signal: sessionRequestSignal(signal) });
  const result = await readJson<AuthSessionResponse>(response, { notifySessionExpired });
  if (result.authenticated === false) return result;
  if (result.authenticated !== true || !isAuthUser(result.user)) {
    throw new ApiRequestError("Invalid session response", response.status);
  }
  return result;
}

export async function getDashboardSummary(): Promise<DashboardSummary> {
  const response = await apiFetch("/api/dashboard/summary");
  const result = await readJson<{ summary: DashboardSummary }>(response);
  return result.summary;
}

export async function getAppSettings(): Promise<AppSettingsResponse> {
  const response = await apiFetch("/api/app/settings");
  return readJson<AppSettingsResponse>(response);
}

export async function getChromaReadiness(signal?: AbortSignal): Promise<ChromaReadiness> {
  const result = await readJson<ChromaReadiness>(await apiFetch("/api/app/readiness", {
    signal: sessionRequestSignal(signal), cache: "no-store",
  }), { notifySessionExpired: false });
  if (result.status !== "ok" || typeof result.version !== "string" || !/^\d+\.\d+\.\d+$/.test(result.version)) {
    throw new ApiRequestError("Invalid Chroma readiness response", 200);
  }
  return result;
}

export async function getChromaUpdateStatus(options: { signal?: AbortSignal; notifySessionExpired?: boolean } = {}): Promise<ChromaUpdateStatus> {
  return readJson<ChromaUpdateStatus>(await apiFetch("/api/app/updates", { signal: sessionRequestSignal(options.signal) }), options);
}

export async function checkChromaUpdates(): Promise<ChromaUpdateStatus> {
  return readJson<ChromaUpdateStatus>(await apiFetch("/api/app/updates/check", { method: "POST" }));
}

export async function saveChromaUpdateSettings(settings: ChromaUpdateSettings): Promise<ChromaUpdateStatus> {
  return readJson<ChromaUpdateStatus>(await apiFetch("/api/app/updates/settings", {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(settings),
  }));
}

export async function installChromaUpdate(version: string): Promise<ChromaUpdateStatus> {
  return readJson<ChromaUpdateStatus>(await apiFetch("/api/app/updates/install", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ version, confirmed: true }),
    signal: AbortSignal.timeout(30_000),
  }), { notifySessionExpired: false });
}

export async function updateAppSettings(payload: UpdateAppSettingsRequest): Promise<AppSettingsResponse> {
  const response = await apiFetch("/api/app/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  return readJson<AppSettingsResponse>(response);
}

export async function getPkiStatus(): Promise<PkiStatusResponse> {
  const response = await apiFetch("/api/pki/status");
  return readJson<PkiStatusResponse>(response);
}

export async function generatePkiCsr(payload: GeneratePkiCsrRequest): Promise<GeneratePkiCsrResponse> {
  const response = await apiFetch("/api/pki/csr", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return readJson<GeneratePkiCsrResponse>(response);
}

export async function installPkiCertificate(certificatePem: string): Promise<InstallPkiCertificateResponse> {
  const response = await apiFetch("/api/pki/certificate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ certificatePem }),
  });
  return readJson<InstallPkiCertificateResponse>(response);
}

export async function getInstances(): Promise<InstanceListResponse> {
  const response = await apiFetch("/api/instances");
  return readJson<InstanceListResponse>(response);
}

export async function getInstance(instanceId: string): Promise<InstanceDetailResponse> {
  const response = await apiFetch(`/api/instances/${instanceId}`);
  return readJson<InstanceDetailResponse>(response);
}

export async function getInstanceRuntimeEvents(instanceId: string): Promise<InstanceRuntimeEventsResponse> {
  const response = await apiFetch(`/api/instances/${instanceId}/events`);
  return readJson<InstanceRuntimeEventsResponse>(response);
}

export async function getInstanceAddons(instanceId: string): Promise<InstanceAddonListResponse> {
  const response = await apiFetch(`/api/instances/${instanceId}/addons`);
  return readJson<InstanceAddonListResponse>(response);
}

export async function getAddonLibrary(): Promise<AddonLibraryListResponse> {
  const response = await apiFetch("/api/addons/library");
  return readJson<AddonLibraryListResponse>(response);
}

export async function deleteAddonFromLibrary(addonFileId: string): Promise<{ success: true }> {
  const response = await apiFetch(`/api/addons/library/${addonFileId}`, {
    method: "DELETE",
  });
  return readJson<{ success: true }>(response);
}

export async function getAddonUpdateSettings(): Promise<AddonUpdateSettingsResponse> {
  const response = await apiFetch("/api/addons/settings");
  return readJson<AddonUpdateSettingsResponse>(response);
}

export async function updateAddonUpdateSettings(
  payload: UpdateAddonUpdateSettingsRequest,
): Promise<AddonUpdateSettingsResponse> {
  const response = await apiFetch("/api/addons/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return readJson<AddonUpdateSettingsResponse>(response);
}

export async function getAddonLibraryEditor(addonFileId: string): Promise<AddonLibraryEditorResponse> {
  const response = await apiFetch(`/api/addons/library/${addonFileId}/editor`);
  return readJson<AddonLibraryEditorResponse>(response);
}

export async function updateAddonLibraryLinks(
  addonFileId: string,
  payload: UpdateAddonLibraryLinksRequest,
): Promise<AddonLibraryEditorResponse> {
  const response = await apiFetch(`/api/addons/library/${addonFileId}/editor`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return readJson<AddonLibraryEditorResponse>(response);
}

export async function selectInstanceLibraryAddons(
  instanceId: string,
  addonFileIds: string[],
): Promise<InstanceAddonListResponse> {
  const response = await apiFetch(`/api/instances/${instanceId}/addons/library`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ addonFileIds }),
  });
  return readJson<InstanceAddonListResponse>(response);
}

export async function updateInstanceAddonOrder(
  instanceId: string,
  payload: UpdateInstanceAddonOrderRequest,
): Promise<InstanceAddonListResponse> {
  const response = await apiFetch(`/api/instances/${instanceId}/addons/order`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return readJson<InstanceAddonListResponse>(response);
}

export async function autoSortInstanceAddons(instanceId: string): Promise<InstanceAddonListResponse> {
  const response = await apiFetch(`/api/instances/${instanceId}/addons/auto-sort`, {
    method: "POST",
  });
  return readJson<InstanceAddonListResponse>(response);
}

export async function getInstanceAddonDetail(instanceId: string, addonId: string): Promise<InstanceAddonDetailResponse> {
  const response = await apiFetch(`/api/instances/${instanceId}/addons/${addonId}`);
  return readJson<InstanceAddonDetailResponse>(response);
}

export async function getCurseForgeAddonProviderStatus(
  instanceId: string,
): Promise<CurseForgeAddonProviderStatusResponse> {
  const response = await apiFetch(`/api/instances/${instanceId}/addons/providers/curseforge/status`);
  return readJson<CurseForgeAddonProviderStatusResponse>(response);
}

export async function getLibraryCurseForgeAddonProviderStatus(): Promise<CurseForgeAddonProviderStatusResponse> {
  const response = await apiFetch("/api/addons/providers/curseforge/status");
  return readJson<CurseForgeAddonProviderStatusResponse>(response);
}

export async function searchCurseForgeAddons(
  instanceId: string,
  payload: CurseForgeAddonSearchRequest,
): Promise<CurseForgeAddonSearchResponse> {
  const params = new URLSearchParams();
  if (payload.q) params.set("q", payload.q);
  if (payload.sort) params.set("sort", payload.sort);
  if (payload.page) params.set("page", String(payload.page));
  if (payload.pageSize) params.set("pageSize", String(payload.pageSize));
  if (payload.gameVersion) params.set("gameVersion", payload.gameVersion);
  if (payload.authorId) params.set("authorId", String(payload.authorId));

  const query = params.toString();
  const response = await apiFetch(
    `/api/instances/${instanceId}/addons/providers/curseforge/search${query ? `?${query}` : ""}`,
  );
  return readJson<CurseForgeAddonSearchResponse>(response);
}

export async function searchLibraryCurseForgeAddons(
  payload: CurseForgeAddonSearchRequest,
): Promise<CurseForgeAddonSearchResponse> {
  const params = new URLSearchParams();
  if (payload.q) params.set("q", payload.q);
  if (payload.sort) params.set("sort", payload.sort);
  if (payload.page) params.set("page", String(payload.page));
  if (payload.pageSize) params.set("pageSize", String(payload.pageSize));
  if (payload.gameVersion) params.set("gameVersion", payload.gameVersion);
  if (payload.authorId) params.set("authorId", String(payload.authorId));

  const query = params.toString();
  const response = await apiFetch(`/api/addons/providers/curseforge/search${query ? `?${query}` : ""}`);
  return readJson<CurseForgeAddonSearchResponse>(response);
}

export async function downloadCurseForgeAddon(
  instanceId: string,
  payload: CurseForgeAddonDownloadRequest,
): Promise<InstanceAddonDetailResponse> {
  const response = await apiFetch(`/api/instances/${instanceId}/addons/providers/curseforge/download`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  return readJson<InstanceAddonDetailResponse>(response);
}

export async function downloadCurseForgeAddonToLibrary(
  payload: CurseForgeAddonDownloadRequest,
): Promise<AddonLibraryDownloadResponse> {
  const response = await apiFetch("/api/addons/providers/curseforge/download", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  return readJson<AddonLibraryDownloadResponse>(response);
}

export async function enableInstanceAddon(instanceId: string, addonId: string): Promise<InstanceAddonDetailResponse> {
  const response = await apiFetch(`/api/instances/${instanceId}/addons/${addonId}/enable`, {
    method: "POST",
  });
  return readJson<InstanceAddonDetailResponse>(response);
}

export async function disableInstanceAddon(instanceId: string, addonId: string): Promise<InstanceAddonDetailResponse> {
  const response = await apiFetch(`/api/instances/${instanceId}/addons/${addonId}/disable`, {
    method: "POST",
  });
  return readJson<InstanceAddonDetailResponse>(response);
}

export async function createInstance(payload: CreateInstanceRequest): Promise<InstanceDetailResponse> {
  const response = await apiFetch("/api/instances", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  return readJson<InstanceDetailResponse>(response);
}

export async function updateInstance(instanceId: string, payload: UpdateInstanceRequest): Promise<InstanceDetailResponse> {
  const response = await apiFetch(`/api/instances/${instanceId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  return readJson<InstanceDetailResponse>(response);
}

export async function deleteInstance(instanceId: string): Promise<{ success: true }> {
  const response = await apiFetch(`/api/instances/${instanceId}`, {
    method: "DELETE",
  });

  return readJson<{ success: true }>(response);
}

export async function getInstanceSettings(instanceId: string): Promise<InstanceSettingsResponse> {
  const response = await apiFetch(`/api/instances/${instanceId}/settings`);
  return readJson<InstanceSettingsResponse>(response);
}

export async function getInstanceServerProperties(instanceId: string): Promise<InstanceServerPropertiesResponse> {
  const response = await apiFetch(`/api/instances/${instanceId}/server-properties`);
  return readJson<InstanceServerPropertiesResponse>(response);
}

export async function updateInstanceServerProperties(
  instanceId: string,
  payload: UpdateInstanceServerPropertiesRequest,
): Promise<InstanceServerPropertiesResponse> {
  const response = await apiFetch(`/api/instances/${instanceId}/server-properties`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  return readJson<InstanceServerPropertiesResponse>(response);
}

export async function getInstanceBdsStatus(instanceId: string): Promise<InstanceBdsStatusResponse> {
  const response = await apiFetch(`/api/instances/${instanceId}/bds/status`);
  return readJson<InstanceBdsStatusResponse>(response);
}

export async function getInstanceBdsRuntime(instanceId: string): Promise<InstanceBdsRuntimeResponse> {
  const response = await apiFetch(`/api/instances/${instanceId}/bds/runtime`);
  return readJson<InstanceBdsRuntimeResponse>(response);
}

export async function getInstanceBdsLogFiles(instanceId: string): Promise<InstanceBdsLogListResponse> {
  const response = await apiFetch(`/api/instances/${instanceId}/bds/logs`);
  return readJson<InstanceBdsLogListResponse>(response);
}

export async function getInstanceCurrentBdsLogTail(instanceId: string, limit = 200): Promise<InstanceBdsLogTailResponse> {
  const response = await apiFetch(`/api/instances/${instanceId}/bds/logs/current/tail?limit=${limit}`);
  return readJson<InstanceBdsLogTailResponse>(response);
}

export async function getInstanceBdsLogPage(
  instanceId: string,
  fileName: string,
  options?: { offset?: number; limit?: number },
): Promise<InstanceBdsLogPageResponse> {
  const offset = options?.offset ?? 0;
  const limit = options?.limit ?? 200;
  const response = await apiFetch(
    `/api/instances/${instanceId}/bds/logs/${encodeURIComponent(fileName)}?offset=${offset}&limit=${limit}`,
  );
  return readJson<InstanceBdsLogPageResponse>(response);
}

export async function startInstanceBds(instanceId: string): Promise<InstanceBdsRuntimeResponse> {
  const response = await apiFetch(`/api/instances/${instanceId}/bds/start`, {
    method: "POST",
  });
  return readJson<InstanceBdsRuntimeResponse>(response);
}

export async function stopInstanceBds(instanceId: string): Promise<InstanceBdsRuntimeResponse> {
  const response = await apiFetch(`/api/instances/${instanceId}/bds/stop`, {
    method: "POST",
  });
  return readJson<InstanceBdsRuntimeResponse>(response);
}

export async function restartInstanceBds(instanceId: string): Promise<InstanceBdsRuntimeResponse> {
  const response = await apiFetch(`/api/instances/${instanceId}/bds/restart`, {
    method: "POST",
  });
  return readJson<InstanceBdsRuntimeResponse>(response);
}

export async function manualUpdateInstanceBds(instanceId: string): Promise<InstanceBdsManualUpdateResponse> {
  const response = await apiFetch(`/api/instances/${instanceId}/bds/update`, {
    method: "POST",
  });
  return readJson<InstanceBdsManualUpdateResponse>(response);
}

export async function sendInstanceConsoleCommand(
  instanceId: string,
  payload: InstanceBdsConsoleCommandRequest,
): Promise<InstanceBdsConsoleCommandResponse> {
  const response = await apiFetch(`/api/instances/${instanceId}/bds/console/commands`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  return readJson<InstanceBdsConsoleCommandResponse>(response);
}

export async function createExportBackup(instanceId: string): Promise<InstanceBackupResponse> {
  const response = await apiFetch(`/api/instances/${instanceId}/backups/export`, {
    method: "POST",
  });
  return readJson<InstanceBackupResponse>(response);
}

export async function importInstanceBackup(file: File): Promise<InstanceBackupImportResponse> {
  const body = new FormData();
  body.append("backup", file);
  const response = await apiFetch("/api/instances/backups/import", {
    method: "POST",
    body,
  });
  return readJson<InstanceBackupImportResponse>(response);
}

export async function linkRestoredInstanceAddonToLibrary(
  instanceId: string,
  addonId: string,
  addonFileId: string,
): Promise<InstanceAddonListResponse> {
  const response = await apiFetch(`/api/instances/${instanceId}/addons/${addonId}/link-library`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ addonFileId }),
  });
  return readJson<InstanceAddonListResponse>(response);
}

export async function getLatestBdsVersion(): Promise<LatestBdsVersionResponse> {
  const response = await apiFetch("/api/bds/latest");
  return readJson<LatestBdsVersionResponse>(response);
}

export async function checkInstanceBdsUpdates(instanceId: string): Promise<InstanceBdsCheckUpdatesResponse> {
  const response = await apiFetch(`/api/instances/${instanceId}/bds/check-updates`, {
    method: "POST",
  });

  return readJson<InstanceBdsCheckUpdatesResponse>(response);
}
export async function getAddonUpdateSummary(): Promise<AddonUpdateSummary> {
  return readJson<AddonUpdateSummary>(await apiFetch("/api/addons/updates"));
}

export async function checkAddonLibraryUpdates(): Promise<AddonUpdateSummary> {
  return readJson<AddonUpdateSummary>(await apiFetch("/api/addons/updates/check", { method: "POST" }));
}

export async function retryInstanceAddonUpdate(instanceId: string, addonId: string): Promise<AddonUpdateSummary> {
  return readJson<AddonUpdateSummary>(await apiFetch(`/api/instances/${encodeURIComponent(instanceId)}/addons/updates/${encodeURIComponent(addonId)}/retry`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmed: true }),
  }));
}
