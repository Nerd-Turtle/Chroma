export type BdsInstallStatus =
  | "not_installed"
  | "installed"
  | "installing"
  | "error";

export type BdsInstall = {
  instanceId: string;
  status: BdsInstallStatus;
  version?: string;
  downloadUrl?: string;
  installedAt?: string;
  updatedAt: string;
  error?: string;
};
