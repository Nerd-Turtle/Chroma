export type BdsRuntimeStatus =
  | "stopped"
  | "starting"
  | "running"
  | "stopping"
  | "error"
  | "unknown";

export type BdsRuntimeDesiredState = "running" | "stopped";

export type BdsRuntimeHealthStatus =
  | "unknown"
  | "pending"
  | "healthy"
  | "degraded"
  | "unhealthy";

export type BdsRuntimeMaintenanceStatus =
  | "idle"
  | "backup"
  | "update"
  | "restore"
  | "config_change";

export type BdsRuntimeState = {
  instanceId: string;
  status: BdsRuntimeStatus;
  desiredStatus: BdsRuntimeDesiredState;
  healthStatus: BdsRuntimeHealthStatus;
  maintenanceStatus: BdsRuntimeMaintenanceStatus;
  observedAt: string;
  isProcessActive: boolean;
  recentLogTail: string[] | undefined;
  pid?: number;
  startedAt?: string;
  stoppedAt?: string;
  exitCode?: number | null;
  signal?: string | null;
  message?: string;
  error?: string;
};
