export type AddonSource = "curseforge" | "manual";

export type InstanceAddonStatus =
  | "installed"
  | "enabled"
  | "disabled"
  | "update_available"
  | "error";

export type InstanceAddon = {
  id: string;
  instanceId: string;
  friendlyName: string;
  source: AddonSource;
  status: InstanceAddonStatus;
  enabled: boolean;
  loadOrder: number;
  minecraftVersions: string[];
  behaviorPackIds: string[];
  resourcePackIds: string[];
  installedAt: string;
  updatedAt: string;
};
