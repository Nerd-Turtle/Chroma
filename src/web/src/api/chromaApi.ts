export type SetupStatusResponse = {
  setupRequired: boolean;
};

export type AuthSessionResponse = {
  authenticated: boolean;
  user?: {
    username: string;
    role: string;
  };
};

export async function getSetupStatus(): Promise<SetupStatusResponse> {
  const response = await fetch("/api/setup/status");
  return response.json();
}

export async function completeSetup(payload: {
  username: string;
  password: string;
  timezone: string;
  language: string;
}) {
  const response = await fetch("/api/setup/complete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return response.json();
}

export async function login(payload: { username: string; password: string }) {
  const response = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return response.json();
}

export async function logout() {
  await fetch("/api/auth/logout", {
    method: "POST",
  });
}

export async function getAuthSession(): Promise<AuthSessionResponse> {
  const response = await fetch("/api/auth/session");
  return response.json();
}
