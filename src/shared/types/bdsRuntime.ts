export type BdsRuntimeStatus =
  | "stopped"
  | "starting"
  | "running"
  | "stopping"
  | "error"
  | "unknown";

export type BdsRuntimeState = {
  instanceId: string;
  status: BdsRuntimeStatus;
  pid?: number;
  startedAt?: string;
  stoppedAt?: string;
  exitCode?: number | null;
  signal?: string | null;
  message?: string;
  error?: string;
};
