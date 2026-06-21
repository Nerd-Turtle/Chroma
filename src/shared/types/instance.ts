export type InstanceStatus =
  | "stopped"
  | "starting"
  | "running"
  | "stopping"
  | "error"
  | "unknown"
  | "degraded"
  | "updating"
  | "backing_up"
  | "restoring";

export type InstanceUpdateCheckFrequency = "daily" | "weekly";
export type InstanceUpdateCheckWeekday =
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday"
  | "sunday";

export type Instance = {
  id: string;
  friendlyName: string;
  status: InstanceStatus;
  bdsVersion: string;
  automaticUpdatesEnabled: boolean;
  updateCheckFrequency: InstanceUpdateCheckFrequency;
  updateCheckTime: string;
  updateCheckWeekday: InstanceUpdateCheckWeekday;
  lastAutoUpdateCheckAt?: string;
  lastCheckAt?: string;
  lastCheckResult?: string;
  instancePath: string;
  activeWorldName?: string;
  createdAt: string;
  updatedAt: string;
};
