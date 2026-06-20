import type {
  AuthSessionResponse,
  BdsStartValidationResult,
  CreateInstanceRequest,
  DashboardSummary,
  InstanceBdsConsoleCommandRequest,
  InstanceBdsConsoleCommandResponse,
  InstanceBdsLogListResponse,
  InstanceBdsLogPageResponse,
  InstanceBdsLogTailResponse,
  InstanceBdsManualUpdateResponse,
  InstanceBdsStartBlockedResponse,
  InstanceBdsRuntimeResponse,
  InstanceBackupResponse,
  InstanceBdsStatusResponse,
  InstanceDetailResponse,
  InstanceRuntimeEventsResponse,
  InstanceServerPropertiesResponse,
  InstanceListResponse,
  InstanceSettingsResponse,
  LatestBdsVersionResponse,
  LoginRequest,
  LoginResponse,
  SetupCompleteRequest,
  SetupStatusResponse,
  UpdateInstanceRequest,
  UpdateInstanceServerPropertiesRequest,
} from "../../../shared/types/index.js";

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

async function readJson<T>(response: Response): Promise<T> {
  const body = (await response.json()) as T & Partial<InstanceBdsStartBlockedResponse> & { error?: string };
  if (!response.ok) {
    const validationMessage =
      body.validation && Array.isArray(body.validation.errors) && body.validation.errors.length > 0
        ? body.validation.errors.map((issue) => issue.message).join(" ")
        : undefined;

    throw new ApiRequestError(
      validationMessage ?? (typeof body.error === "string" ? body.error : "Request failed"),
      response.status,
      { validation: body.validation },
    );
  }

  return body;
}

export async function getSetupStatus(): Promise<SetupStatusResponse> {
  const response = await fetch("/api/setup/status");
  return readJson<SetupStatusResponse>(response);
}

export async function completeSetup(payload: SetupCompleteRequest): Promise<{ success: true }> {
  const response = await fetch("/api/setup/complete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  return readJson<{ success: true }>(response);
}

export async function login(payload: LoginRequest): Promise<LoginResponse> {
  const response = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  return readJson<LoginResponse>(response);
}

export async function logout(): Promise<void> {
  await fetch("/api/auth/logout", {
    method: "POST",
  });
}

export async function getSession(): Promise<AuthSessionResponse> {
  const response = await fetch("/api/auth/session");
  return readJson<AuthSessionResponse>(response);
}

export async function getDashboardSummary(): Promise<DashboardSummary> {
  const response = await fetch("/api/dashboard/summary");
  const result = await readJson<{ summary: DashboardSummary }>(response);
  return result.summary;
}

export async function getInstances(): Promise<InstanceListResponse> {
  const response = await fetch("/api/instances");
  return readJson<InstanceListResponse>(response);
}

export async function getInstance(instanceId: string): Promise<InstanceDetailResponse> {
  const response = await fetch(`/api/instances/${instanceId}`);
  return readJson<InstanceDetailResponse>(response);
}

export async function getInstanceRuntimeEvents(instanceId: string): Promise<InstanceRuntimeEventsResponse> {
  const response = await fetch(`/api/instances/${instanceId}/events`);
  return readJson<InstanceRuntimeEventsResponse>(response);
}

export async function createInstance(payload: CreateInstanceRequest): Promise<InstanceDetailResponse> {
  const response = await fetch("/api/instances", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  return readJson<InstanceDetailResponse>(response);
}

export async function updateInstance(instanceId: string, payload: UpdateInstanceRequest): Promise<InstanceDetailResponse> {
  const response = await fetch(`/api/instances/${instanceId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  return readJson<InstanceDetailResponse>(response);
}

export async function getInstanceSettings(instanceId: string): Promise<InstanceSettingsResponse> {
  const response = await fetch(`/api/instances/${instanceId}/settings`);
  return readJson<InstanceSettingsResponse>(response);
}

export async function getInstanceServerProperties(instanceId: string): Promise<InstanceServerPropertiesResponse> {
  const response = await fetch(`/api/instances/${instanceId}/server-properties`);
  return readJson<InstanceServerPropertiesResponse>(response);
}

export async function updateInstanceServerProperties(
  instanceId: string,
  payload: UpdateInstanceServerPropertiesRequest,
): Promise<InstanceServerPropertiesResponse> {
  const response = await fetch(`/api/instances/${instanceId}/server-properties`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  return readJson<InstanceServerPropertiesResponse>(response);
}

export async function getInstanceBdsStatus(instanceId: string): Promise<InstanceBdsStatusResponse> {
  const response = await fetch(`/api/instances/${instanceId}/bds/status`);
  return readJson<InstanceBdsStatusResponse>(response);
}

export async function getInstanceBdsRuntime(instanceId: string): Promise<InstanceBdsRuntimeResponse> {
  const response = await fetch(`/api/instances/${instanceId}/bds/runtime`);
  return readJson<InstanceBdsRuntimeResponse>(response);
}

export async function getInstanceBdsLogFiles(instanceId: string): Promise<InstanceBdsLogListResponse> {
  const response = await fetch(`/api/instances/${instanceId}/bds/logs`);
  return readJson<InstanceBdsLogListResponse>(response);
}

export async function getInstanceCurrentBdsLogTail(instanceId: string, limit = 200): Promise<InstanceBdsLogTailResponse> {
  const response = await fetch(`/api/instances/${instanceId}/bds/logs/current/tail?limit=${limit}`);
  return readJson<InstanceBdsLogTailResponse>(response);
}

export async function getInstanceBdsLogPage(
  instanceId: string,
  fileName: string,
  options?: { offset?: number; limit?: number },
): Promise<InstanceBdsLogPageResponse> {
  const offset = options?.offset ?? 0;
  const limit = options?.limit ?? 200;
  const response = await fetch(
    `/api/instances/${instanceId}/bds/logs/${encodeURIComponent(fileName)}?offset=${offset}&limit=${limit}`,
  );
  return readJson<InstanceBdsLogPageResponse>(response);
}

export async function startInstanceBds(instanceId: string): Promise<InstanceBdsRuntimeResponse> {
  const response = await fetch(`/api/instances/${instanceId}/bds/start`, {
    method: "POST",
  });
  return readJson<InstanceBdsRuntimeResponse>(response);
}

export async function stopInstanceBds(instanceId: string): Promise<InstanceBdsRuntimeResponse> {
  const response = await fetch(`/api/instances/${instanceId}/bds/stop`, {
    method: "POST",
  });
  return readJson<InstanceBdsRuntimeResponse>(response);
}

export async function restartInstanceBds(instanceId: string): Promise<InstanceBdsRuntimeResponse> {
  const response = await fetch(`/api/instances/${instanceId}/bds/restart`, {
    method: "POST",
  });
  return readJson<InstanceBdsRuntimeResponse>(response);
}

export async function manualUpdateInstanceBds(instanceId: string): Promise<InstanceBdsManualUpdateResponse> {
  const response = await fetch(`/api/instances/${instanceId}/bds/update`, {
    method: "POST",
  });
  return readJson<InstanceBdsManualUpdateResponse>(response);
}

export async function sendInstanceConsoleCommand(
  instanceId: string,
  payload: InstanceBdsConsoleCommandRequest,
): Promise<InstanceBdsConsoleCommandResponse> {
  const response = await fetch(`/api/instances/${instanceId}/bds/console/commands`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  return readJson<InstanceBdsConsoleCommandResponse>(response);
}

export async function createExportBackup(instanceId: string): Promise<InstanceBackupResponse> {
  const response = await fetch(`/api/instances/${instanceId}/backups/export`, {
    method: "POST",
  });
  return readJson<InstanceBackupResponse>(response);
}

export async function getLatestBdsVersion(): Promise<LatestBdsVersionResponse> {
  const response = await fetch("/api/bds/latest");
  return readJson<LatestBdsVersionResponse>(response);
}
