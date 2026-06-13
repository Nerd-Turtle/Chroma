import type { AppSettings, AuthUser } from "./auth.js";

export type SetupStatusResponse = {
  setupRequired: boolean;
};

export type SetupCompleteRequest = {
  username: string;
  password: string;
  timezone: string;
  language: string;
};

export type AuthSessionResponse =
  | {
      authenticated: false;
    }
  | {
      authenticated: true;
      user: AuthUser;
    };

export type LoginRequest = {
  username: string;
  password: string;
};

export type LoginResponse = {
  authenticated: true;
  user: AuthUser;
};

export type DashboardSummary = {
  instanceCount: number;
  runningInstanceCount: number;
  stoppedInstanceCount: number;
  appSettings?: AppSettings;
};
