import type {
  AuthSessionResponse,
  DashboardSummary,
  LoginRequest,
  LoginResponse,
  SetupCompleteRequest,
  SetupStatusResponse,
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
