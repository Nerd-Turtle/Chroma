import type { AppSettings, AuthUser } from "./auth.js";
import type { BdsConsoleSnapshot } from "./bdsConsole.js";
import type { BdsInstall } from "./bds.js";
import type { BdsRuntimeHealthStatus, BdsRuntimeState, BdsRuntimeStatus } from "./bdsRuntime.js";
import type {
  AddonLibraryLinkedInstance,
  CurseForgeAddonProviderStatus,
  CurseForgeAddonSearchPagination,
  CurseForgeAddonSearchResult,
  CurseForgeAddonSearchSort,
  AddonLibraryItem,
  AddonUpdateSettings,
  InstanceAddon,
  InstanceAddonPack,
} from "./addon.js";
import type { Instance, InstanceStatus, InstanceUpdateCheckFrequency, InstanceUpdateCheckWeekday } from "./instance.js";
import type { InstanceRuntimeEvent } from "./runtimeEvent.js";
import type { BedrockServerSettings } from "./serverSettings.js";

export type BdsStartValidationIssue = {
  code: string;
  level: "error" | "warning";
  message: string;
  field?: string;
};

export type BdsStartValidationResult = {
  canStart: boolean;
  errors: BdsStartValidationIssue[];
  warnings: BdsStartValidationIssue[];
};

export type SetupStatusResponse = {
  setupRequired: boolean;
};

export type SetupCompleteRequest = {
  username: string;
  password: string;
  timezone: string;
  language: string;
  curseForgeApiKey?: string;
};

export type AppSettingsResponse = {
  settings: AppSettings;
};

export type UpdateAppSettingsRequest = {
  timezone: string;
  language: string;
  notificationDurationSeconds: number;
  curseForgeApiKey?: string;
  clearCurseForgeApiKey?: boolean;
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

export type DashboardInstanceHealthCategory = "healthy" | "error" | "stopped";

export type DashboardSystemPerformance = {
  cpuUsagePercent: number;
  ramUsageBytes: number;
  ramTotalBytes: number;
  ramUsagePercent: number;
};

export type DashboardInstancePerformance = {
  instanceId: string;
  friendlyName: string;
  status: InstanceStatus;
  healthCategory: DashboardInstanceHealthCategory;
  runtimeStatus: BdsRuntimeStatus;
  runtimeHealthStatus: BdsRuntimeHealthStatus;
  isProcessActive: boolean;
  pid?: number;
  cpuUsagePercent?: number;
  ramUsageBytes?: number;
};

export type DashboardHealthSegment = {
  instanceId: string;
  friendlyName: string;
  healthCategory: DashboardInstanceHealthCategory;
};

export type DashboardHealthSummary = {
  healthyCount: number;
  errorCount: number;
  stoppedCount: number;
  segments: DashboardHealthSegment[];
};

export type DashboardSummary = {
  instanceCount: number;
  runningInstanceCount: number;
  stoppedInstanceCount: number;
  systemPerformance: DashboardSystemPerformance;
  instancePerformance: DashboardInstancePerformance[];
  instanceHealth: DashboardHealthSummary;
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

export type InstanceRuntimeEventsResponse = {
  events: InstanceRuntimeEvent[];
};

export type InstanceAddonListResponse = {
  addons: InstanceAddon[];
};

export type UpdateInstanceAddonOrderRequest = {
  addonIds: string[];
};

export type AddonLibraryListResponse = {
  addons: AddonLibraryItem[];
};

export type AddonLibraryDownloadResponse = {
  addon: AddonLibraryItem;
};

export type AddonUpdateSettingsResponse = {
  settings: AddonUpdateSettings;
};

export type UpdateAddonUpdateSettingsRequest = AddonUpdateSettings;

export type UpdateAddonLibraryLinksRequest = {
  links: Array<{
    instanceId: string;
    autoUpdateEnabled: boolean;
  }>;
};

export type AddonLibraryEditorResponse = {
  addon: AddonLibraryItem;
  instances: AddonLibraryLinkedInstance[];
};

export type InstanceAddonDetailResponse = {
  addon: InstanceAddon;
  packs: InstanceAddonPack[];
};

export type CurseForgeAddonProviderStatusResponse = {
  provider: CurseForgeAddonProviderStatus;
};

export type CurseForgeAddonSearchResponse = {
  provider: CurseForgeAddonProviderStatus;
  results: CurseForgeAddonSearchResult[];
  pagination: CurseForgeAddonSearchPagination;
};

export type CurseForgeAddonSearchRequest = {
  q?: string;
  sort?: CurseForgeAddonSearchSort;
  page?: number;
  pageSize?: number;
  gameVersion?: string;
};

export type CurseForgeAddonDownloadRequest = {
  projectId: number;
  fileId: number;
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

export type InstanceBdsConsoleCommandRequest = {
  command: string;
};

export type InstanceBdsConsoleCommandResponse = {
  accepted: true;
};

export type InstanceBdsConsoleSnapshotResponse = {
  console: BdsConsoleSnapshot;
};

export type InstanceBdsLogFileSummary = {
  fileName: string;
  current: boolean;
  sizeBytes: number;
  updatedAt: string;
};

export type InstanceBdsLogListResponse = {
  files: InstanceBdsLogFileSummary[];
};

export type InstanceBdsLogTailResponse = {
  fileName: string;
  lines: string[];
};

export type InstanceBdsLogPageResponse = {
  fileName: string;
  lines: string[];
  offset: number;
  limit: number;
  totalLines: number;
  hasPrevious: boolean;
  hasNext: boolean;
};

export type InstanceBdsStartBlockedResponse = {
  error: string;
  validation: BdsStartValidationResult;
};

export type LatestBdsVersionResponse = {
  version?: string;
  downloadUrl: string;
};

export type InstanceBdsCheckUpdatesResponse = {
  checkedAt: string;
  currentVersion: string;
  latestVersion?: string;
  updateAvailable: boolean;
  result: string;
};

export type InstanceBackupResponse = {
  backupId: string;
  fileName: string;
  createdAt: string;
  mode: "internal" | "export";
};
