export type ChromaUpdateSettings = {
  automaticChecksEnabled: boolean;
  mode: "notify" | "install";
  checkIntervalHours: 6 | 12 | 24;
};

export type ChromaRelease = {
  version: string;
  url: string;
  publishedAt: string;
  compatible: boolean;
};

export type ChromaUpgradeProgress = {
  version: string;
  state: "installing" | "succeeded" | "failed";
  message: string;
  startedAt: string;
};

export type ChromaUpdateStatus = {
  currentVersion: string;
  settings: ChromaUpdateSettings;
  latestRelease: ChromaRelease | null;
  updateAvailable: boolean;
  lastCheckedAt: string | null;
  checkError: string | null;
  automaticInstallError: string | null;
  upgrade: ChromaUpgradeProgress | null;
  busyInstanceCount: number;
  installationSupported: boolean;
  installationUnavailableReason: string | null;
};
