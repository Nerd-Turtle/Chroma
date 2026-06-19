import type {
  AuthSessionResponse,
  CreateInstanceRequest,
  DashboardSummary,
  InstanceBdsManualUpdateResponse,
  InstanceBdsRuntimeResponse,
  InstanceBackupResponse,
  InstanceBdsStatusResponse,
  InstanceDetailResponse,
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

async function readJson<T>(response: Response): Promise<T> {
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    throw new Error(typeof body.error === "string" ? body.error : "Request failed");
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
