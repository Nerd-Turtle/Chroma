export type InstanceStatus =
  | "stopped"
  | "starting"
  | "running"
  | "stopping"
  | "error";

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
  instancePath: string;
  activeWorldName?: string;
  createdAt: string;
  updatedAt: string;
};
