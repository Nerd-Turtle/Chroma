export type AddonLibraryUpdateCheck = {
  projectId: string;
  name: string;
  state: "current" | "downloaded" | "review" | "error";
  message: string;
  checkedAt: string;
};

export type InstanceAddonUpdate = {
  instanceId: string;
  instanceName: string;
  addonId: string;
  addonName: string;
  targetFileId: string;
  previousVersion: string;
  targetVersion: string;
  state: "pending" | "applying" | "succeeded" | "review" | "failed";
  message: string;
  updatedAt: string;
};

export type AddonUpdateSummary = {
  lastCheckedAt: string | null;
  checkError: string | null;
  checks: AddonLibraryUpdateCheck[];
  updates: InstanceAddonUpdate[];
};
