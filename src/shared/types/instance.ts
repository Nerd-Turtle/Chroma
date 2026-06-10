export type InstanceStatus =
  | "stopped"
  | "starting"
  | "running"
  | "stopping"
  | "error";

export type Instance = {
  id: string;
  friendlyName: string;
  slug: string;
  status: InstanceStatus;
  bdsVersion: string;
  instancePath: string;
  activeWorldName?: string;
  createdAt: string;
  updatedAt: string;
};
