import type { AppSettings, AuthUser } from "./auth.js";
import type { BdsInstall } from "./bds.js";
import type { BdsRuntimeState } from "./bdsRuntime.js";
import type { Instance, InstanceUpdateCheckFrequency, InstanceUpdateCheckWeekday } from "./instance.js";
import type { BedrockServerSettings } from "./serverSettings.js";

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

export type InstanceListResponse = {
  instances: Instance[];
};

export type CreateInstanceRequest = {
  friendlyName: string;
  bdsVersion: string;
  automaticUpdatesEnabled: boolean;
  updateCheckFrequency: InstanceUpdateCheckFrequency;
  updateCheckTime: string;
  updateCheckWeekday: InstanceUpdateCheckWeekday;
};

export type UpdateInstanceRequest = {
  friendlyName: string;
  automaticUpdatesEnabled: boolean;
  updateCheckFrequency: InstanceUpdateCheckFrequency;
  updateCheckTime: string;
  updateCheckWeekday: InstanceUpdateCheckWeekday;
};

export type InstanceDetailResponse = {
  instance: Instance;
};

export type InstanceSettingsResponse = {
  settings: BedrockServerSettings;
  restartRequired?: boolean;
};

export type InstanceServerPropertiesResponse = {
  content: string;
  filePath: string;
  restartRequired: boolean;
};

export type UpdateInstanceServerPropertiesRequest = {
  content: string;
};

export type InstanceBdsStatusResponse = {
  bds: BdsInstall;
};

export type InstanceBdsManualUpdateResponse = {
  bds: BdsInstall;
};

export type InstanceBdsRuntimeResponse = {
  runtime: BdsRuntimeState;
};

export type LatestBdsVersionResponse = {
  version?: string;
  downloadUrl: string;
};

export type InstanceBackupResponse = {
  backupId: string;
  fileName: string;
  createdAt: string;
  mode: "internal" | "export";
};
