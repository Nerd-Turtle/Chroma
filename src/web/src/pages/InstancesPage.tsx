import { ArrowDownToLine, LoaderCircle, Play, RotateCw, Save, Square } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type {
  BdsInstall,
  BdsRuntimeState,
  BedrockServerSettings,
  Instance,
} from "../../../shared/types/index.js";
import {
  createInstance,
  createExportBackup,
  getInstance,
  getInstanceBdsRuntime,
  getInstanceBdsStatus,
  getInstances,
  getInstanceServerProperties,
  getInstanceSettings,
  getLatestBdsVersion,
  manualUpdateInstanceBds,
  restartInstanceBds,
  startInstanceBds,
  stopInstanceBds,
  updateInstance,
  updateInstanceServerProperties,
} from "../api/chromaApi.js";

type InstanceWorkspaceData = {
  instance: Instance;
  settings: BedrockServerSettings;
  bds: BdsInstall;
  runtime: BdsRuntimeState;
};

type RightPaneMode = "details" | "create";
type RightPaneTab = "overview" | "properties" | "addons";
type InstanceEditorState = {
  friendlyName: string;
  automaticUpdatesEnabled: boolean;
  updateCheckFrequency: "daily" | "weekly";
  updateCheckTime: string;
  updateCheckWeekday: "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday" | "sunday";
};

type ServerPropertiesEditorState = {
  content: string;
  filePath: string;
  restartRequired: boolean;
};

type BannerTone = "success" | "warning" | "alert";

type BannerState = {
  message: string;
  tone: BannerTone;
};

function formatTimestamp(value?: string): string {
  if (!value) {
    return "Pending";
  }

  return new Date(value).toLocaleString();
}

function formatWeekday(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function parseServerPropertiesPreview(content: string): Array<{ key: string; value: string }> {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"))
    .map((line) => {
      const separatorIndex = line.indexOf("=");

      if (separatorIndex === -1) {
        return null;
      }

      return {
        key: line.slice(0, separatorIndex).trim(),
        value: line.slice(separatorIndex + 1).trim(),
      };
    })
    .filter((entry): entry is { key: string; value: string } => entry !== null);
}

const DEFAULT_BDS_VERSION = "latest";
const DEFAULT_UPDATE_TIME = "03:00";
const DEFAULT_UPDATE_WEEKDAY = "sunday";

function ActionIcon({ active, children }: { active: boolean; children: ReactNode }) {
  if (active) {
    return <LoaderCircle className="icon-action-spinner" aria-hidden="true" />;
  }

  return <>{children}</>;
}

function getDefaultListPaneWidth(): number {
  return Math.max(320, Math.min(window.innerWidth * 0.4, window.innerWidth - 320));
}

function getBdsListStatus(instance: Instance, bds?: BdsInstall): string {
  if (!bds) {
    return "Checking";
  }

  if (bds.status === "installing") {
    return "Installing";
  }

  if (bds.status === "error") {
    return "Error";
  }

  if (bds.status === "not_installed" || !bds.version) {
    return "Not installed";
  }

  return bds.version === instance.bdsVersion ? "Current" : "Update available";
}

function getRuntimeListStatus(instance: Instance): string {
  return instance.status.charAt(0).toUpperCase() + instance.status.slice(1);
}

function getAutoUpdateListStatus(instance: Instance): string {
  return instance.automaticUpdatesEnabled ? "Enabled" : "Disabled";
}

function getVersionListStatus(instance: Instance, bds?: BdsInstall, latestBdsVersion?: string): string {
  if (bds?.status === "error") {
    return "Install error";
  }

  if (bds?.status === "installing") {
    return "Installing";
  }

  if (bds?.status === "not_installed") {
    return "Not installed";
  }

  if (!latestBdsVersion) {
    return "Checking";
  }

  if (instance.bdsVersion === latestBdsVersion) {
    return "Current";
  }

  return `Update available: ${latestBdsVersion}`;
}

const InstancesPage = () => {
  const dragState = useRef<{ startX: number; startWidth: number } | null>(null);
  const updateMenuRef = useRef<HTMLDivElement | null>(null);
  const [instances, setInstances] = useState<Instance[]>([]);
  const [instanceBdsStatuses, setInstanceBdsStatuses] = useState<Record<string, BdsInstall>>({});
  const [selectedInstanceId, setSelectedInstanceId] = useState<string>("");
  const [workspaceData, setWorkspaceData] = useState<InstanceWorkspaceData | null>(null);
  const [latestBdsVersion, setLatestBdsVersion] = useState<string>("");
  const [listLoading, setListLoading] = useState(true);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [creatingInstance, setCreatingInstance] = useState(false);
  const [savingInstance, setSavingInstance] = useState(false);
  const [serverPropertiesEditorOpen, setServerPropertiesEditorOpen] = useState(false);
  const [serverPropertiesLoading, setServerPropertiesLoading] = useState(false);
  const [serverPropertiesSaving, setServerPropertiesSaving] = useState(false);
  const [serverPropertiesData, setServerPropertiesData] = useState<ServerPropertiesEditorState | null>(null);
  const [serverPropertiesError, setServerPropertiesError] = useState("");
  const [serverPropertiesNotice, setServerPropertiesNotice] = useState("");
  const [banner, setBanner] = useState<BannerState | null>(null);
  const [updateMenuOpen, setUpdateMenuOpen] = useState(false);
  const [actionInFlight, setActionInFlight] = useState<"start" | "stop" | "restart" | "backup" | "check-update" | "update" | "">("");
  const [editingInstance, setEditingInstance] = useState(false);
  const [rightPaneMode, setRightPaneMode] = useState<RightPaneMode>("details");
  const [activeTab, setActiveTab] = useState<RightPaneTab>("overview");
  const [createFriendlyName, setCreateFriendlyName] = useState("");
  const [automaticUpdatingEnabled, setAutomaticUpdatingEnabled] = useState(true);
  const [updateCheckFrequency, setUpdateCheckFrequency] = useState<"daily" | "weekly">("daily");
  const [updateCheckTime, setUpdateCheckTime] = useState(DEFAULT_UPDATE_TIME);
  const [updateCheckWeekday, setUpdateCheckWeekday] = useState<
    "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday" | "sunday"
  >(DEFAULT_UPDATE_WEEKDAY);
  const [instanceEditor, setInstanceEditor] = useState<InstanceEditorState>({
    friendlyName: "",
    automaticUpdatesEnabled: true,
    updateCheckFrequency: "daily",
    updateCheckTime: DEFAULT_UPDATE_TIME,
    updateCheckWeekday: DEFAULT_UPDATE_WEEKDAY,
  });
  const [listPaneWidth, setListPaneWidth] = useState(getDefaultListPaneWidth);
  const [error, setError] = useState("");

  async function loadInstances(preferredInstanceId?: string) {
    setListLoading(true);
    setError("");

    try {
      const result = await getInstances();
      setInstances(result.instances);
      try {
        const latestResult = await getLatestBdsVersion();
        setLatestBdsVersion(latestResult.version ?? "");
      } catch {
        setLatestBdsVersion("");
      }
      const bdsResults = await Promise.all(
        result.instances.map(async (instance) => {
          try {
            const statusResult = await getInstanceBdsStatus(instance.id);
            return [instance.id, statusResult.bds] as const;
          } catch {
            return [instance.id, { instanceId: instance.id, status: "error", updatedAt: new Date().toISOString(), error: "Unavailable" } as BdsInstall] as const;
          }
        })
      );

      setInstanceBdsStatuses(Object.fromEntries(bdsResults));
      setSelectedInstanceId((currentSelectedId) => {
        if (preferredInstanceId && result.instances.some((instance) => instance.id === preferredInstanceId)) {
          return preferredInstanceId;
        }

        if (currentSelectedId && result.instances.some((instance) => instance.id === currentSelectedId)) {
          return currentSelectedId;
        }

        return result.instances[0]?.id ?? "";
      });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load instances");
    } finally {
      setListLoading(false);
    }
  }

  useEffect(() => {
    void loadInstances();
  }, []);

  useEffect(() => {
    if (rightPaneMode !== "details" || !selectedInstanceId) {
      if (!selectedInstanceId) {
        setWorkspaceData(null);
      }
      return;
    }

    async function loadWorkspaceData() {
      setDetailsLoading(true);
      setError("");

      try {
        const [instanceResult, settingsResult, bdsResult, runtimeResult] = await Promise.all([
          getInstance(selectedInstanceId),
          getInstanceSettings(selectedInstanceId),
          getInstanceBdsStatus(selectedInstanceId),
          getInstanceBdsRuntime(selectedInstanceId),
        ]);

        setWorkspaceData({
          instance: instanceResult.instance,
          settings: settingsResult.settings,
          bds: bdsResult.bds,
          runtime: runtimeResult.runtime,
        });
        setInstanceEditor({
          friendlyName: instanceResult.instance.friendlyName,
          automaticUpdatesEnabled: instanceResult.instance.automaticUpdatesEnabled,
          updateCheckFrequency: instanceResult.instance.updateCheckFrequency,
          updateCheckTime: instanceResult.instance.updateCheckTime,
          updateCheckWeekday: instanceResult.instance.updateCheckWeekday,
        });
      } catch (loadError) {
        setWorkspaceData(null);
        setError(loadError instanceof Error ? loadError.message : "Unable to load instance details");
      } finally {
        setDetailsLoading(false);
      }
    }

    void loadWorkspaceData();
  }, [rightPaneMode, selectedInstanceId]);

  useEffect(() => {
    if (rightPaneMode !== "details" || !selectedInstanceId) {
      setServerPropertiesEditorOpen(false);
      setServerPropertiesData(null);
      setServerPropertiesError("");
      setServerPropertiesNotice("");
      setUpdateMenuOpen(false);
      setEditingInstance(false);
    }
  }, [rightPaneMode, selectedInstanceId]);

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (!updateMenuOpen || !updateMenuRef.current) {
        return;
      }

      if (!updateMenuRef.current.contains(event.target as Node)) {
        setUpdateMenuOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setUpdateMenuOpen(false);
      }
    }

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [updateMenuOpen]);

  useEffect(() => {
    setActiveTab("overview");
  }, [rightPaneMode, selectedInstanceId]);

  useEffect(() => {
    if (rightPaneMode !== "details" || activeTab !== "properties" || !selectedInstanceId || serverPropertiesData || serverPropertiesLoading) {
      return;
    }

    void openServerPropertiesEditor(true);
  }, [activeTab, rightPaneMode, selectedInstanceId, serverPropertiesData, serverPropertiesLoading]);

  useEffect(() => {
    function handlePointerMove(event: PointerEvent) {
      if (!dragState.current) {
        return;
      }

      const nextWidth = dragState.current.startWidth + (event.clientX - dragState.current.startX);
      const maxWidth = Math.max(420, Math.min(window.innerWidth * 0.7, window.innerWidth - 320));
      setListPaneWidth(Math.max(280, Math.min(maxWidth, nextWidth)));
    }

    function handlePointerUp() {
      dragState.current = null;
      document.body.classList.remove("is-resizing");
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, []);

  async function refreshSelectedInstance(instanceId: string) {
    const [instanceResult, settingsResult, bdsResult, runtimeResult] = await Promise.all([
      getInstance(instanceId),
      getInstanceSettings(instanceId),
      getInstanceBdsStatus(instanceId),
      getInstanceBdsRuntime(instanceId),
    ]);

    setWorkspaceData({
      instance: instanceResult.instance,
      settings: settingsResult.settings,
      bds: bdsResult.bds,
      runtime: runtimeResult.runtime,
    });
    setInstanceEditor({
      friendlyName: instanceResult.instance.friendlyName,
      automaticUpdatesEnabled: instanceResult.instance.automaticUpdatesEnabled,
      updateCheckFrequency: instanceResult.instance.updateCheckFrequency,
      updateCheckTime: instanceResult.instance.updateCheckTime,
      updateCheckWeekday: instanceResult.instance.updateCheckWeekday,
    });
  }

  const handleCreateInstance = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setCreatingInstance(true);
    setError("");
    setBanner(null);

    try {
      const result = await createInstance({
        friendlyName: createFriendlyName.trim(),
        bdsVersion: DEFAULT_BDS_VERSION,
        automaticUpdatesEnabled: automaticUpdatingEnabled,
        updateCheckFrequency,
        updateCheckTime,
        updateCheckWeekday,
      });

      setCreateFriendlyName("");
      setAutomaticUpdatingEnabled(true);
      setUpdateCheckFrequency("daily");
      setUpdateCheckTime(DEFAULT_UPDATE_TIME);
      setUpdateCheckWeekday(DEFAULT_UPDATE_WEEKDAY);
      setRightPaneMode("details");
      await loadInstances(result.instance.id);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Unable to create instance");
    } finally {
      setCreatingInstance(false);
    }
  };

  const handleSaveInstance = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!selectedInstanceId) {
      return;
    }

    setSavingInstance(true);
    setError("");
    setBanner(null);

    try {
      await updateInstance(selectedInstanceId, instanceEditor);
      await loadInstances(selectedInstanceId);
      await refreshSelectedInstance(selectedInstanceId);
      setEditingInstance(false);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save instance");
    } finally {
      setSavingInstance(false);
    }
  };

  const closeInstanceEditor = () => {
    if (savingInstance || !workspaceData) {
      return;
    }

    setEditingInstance(false);
    setInstanceEditor({
      friendlyName: workspaceData.instance.friendlyName,
      automaticUpdatesEnabled: workspaceData.instance.automaticUpdatesEnabled,
      updateCheckFrequency: workspaceData.instance.updateCheckFrequency,
      updateCheckTime: workspaceData.instance.updateCheckTime,
      updateCheckWeekday: workspaceData.instance.updateCheckWeekday,
    });
  };

  const handleRuntimeAction = async (action: "start" | "stop" | "restart") => {
    if (!selectedInstanceId) {
      return;
    }

    setActionInFlight(action);
    setError("");
    setBanner(null);

    try {
      if (action === "start") {
        await startInstanceBds(selectedInstanceId);
      } else if (action === "stop") {
        await stopInstanceBds(selectedInstanceId);
      } else {
        await restartInstanceBds(selectedInstanceId);
      }

      await loadInstances(selectedInstanceId);
      await refreshSelectedInstance(selectedInstanceId);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : `Unable to ${action} instance`);
    } finally {
      setActionInFlight("");
    }
  };

  const handleExportBackup = async () => {
    if (!selectedInstanceId) {
      return;
    }

    setActionInFlight("backup");
    setError("");
    setBanner(null);

    try {
      const backup = await createExportBackup(selectedInstanceId);
      const downloadUrl = `/api/instances/${selectedInstanceId}/backups/export/${backup.backupId}/download`;
      window.location.href = downloadUrl;
    } catch (backupError) {
      setError(backupError instanceof Error ? backupError.message : "Unable to create backup");
    } finally {
      setActionInFlight("");
    }
  };

  const handleCheckForUpdates = async () => {
    if (!selectedInstanceId || !workspaceData) {
      return;
    }

    setActionInFlight("check-update");
    setError("");
    setBanner(null);
    setUpdateMenuOpen(false);

    try {
      const latestResult = await getLatestBdsVersion();
      setLatestBdsVersion(latestResult.version ?? "");
      await loadInstances(selectedInstanceId);
      await refreshSelectedInstance(selectedInstanceId);

      if (!latestResult.version) {
        setBanner({ message: "Unable to determine the latest BDS version right now.", tone: "warning" });
        return;
      }

      if (latestResult.version === workspaceData.instance.bdsVersion) {
        setBanner({ message: `No updates available. This instance is already on ${latestResult.version}.`, tone: "success" });
        return;
      }

      setBanner({
        message: `Update available: ${latestResult.version}. Current instance version: ${workspaceData.instance.bdsVersion}.`,
        tone: "warning",
      });
    } catch (checkError) {
      setError(checkError instanceof Error ? checkError.message : "Unable to check for updates");
    } finally {
      setActionInFlight("");
    }
  };

  const handleManualUpdate = async () => {
    if (!selectedInstanceId) {
      return;
    }

    setActionInFlight("update");
    setError("");
    setBanner(null);
    setUpdateMenuOpen(false);

    try {
      const latestResult = await getLatestBdsVersion();
      setLatestBdsVersion(latestResult.version ?? "");

      if (latestResult.version && workspaceData && latestResult.version === workspaceData.instance.bdsVersion) {
        setBanner({ message: `No updates available. This instance is already on ${latestResult.version}.`, tone: "success" });
        return;
      }

      await manualUpdateInstanceBds(selectedInstanceId);
      await loadInstances(selectedInstanceId);
      await refreshSelectedInstance(selectedInstanceId);
      if (activeTab === "properties") {
        await openServerPropertiesEditor(true);
      }
      setBanner({
        message: latestResult.version
          ? `Update complete. Instance is now on ${latestResult.version}.`
          : "Update check completed.",
        tone: "success",
      });
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Unable to update BDS");
    } finally {
      setActionInFlight("");
    }
  };

  const openServerPropertiesEditor = async (backgroundOnly = false) => {
    if (!selectedInstanceId) {
      return;
    }

    setServerPropertiesLoading(true);
    setServerPropertiesError("");
    if (!backgroundOnly) {
      setServerPropertiesNotice("");
      setServerPropertiesEditorOpen(true);
    }

    try {
      const result = await getInstanceServerProperties(selectedInstanceId);
      setServerPropertiesData({
        content: result.content,
        filePath: result.filePath,
        restartRequired: result.restartRequired,
      });
    } catch (loadError) {
      setServerPropertiesError(loadError instanceof Error ? loadError.message : "Unable to load server.properties");
    } finally {
      setServerPropertiesLoading(false);
    }
  };

  const closeServerPropertiesEditor = () => {
    if (serverPropertiesSaving) {
      return;
    }

    setServerPropertiesEditorOpen(false);
    setServerPropertiesError("");
    setServerPropertiesNotice("");
  };

  const updateServerPropertiesContent = (content: string) => {
    setServerPropertiesData((current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        content,
      };
    });
  };

  const handleSaveServerProperties = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!selectedInstanceId || !serverPropertiesData) {
      return;
    }

    setServerPropertiesSaving(true);
    setServerPropertiesError("");
    setServerPropertiesNotice("");

    try {
      const result = await updateInstanceServerProperties(selectedInstanceId, {
        content: serverPropertiesData.content,
      });

      setServerPropertiesData({
        content: result.content,
        filePath: result.filePath,
        restartRequired: result.restartRequired,
      });
      await loadInstances(selectedInstanceId);
      await refreshSelectedInstance(selectedInstanceId);
      setServerPropertiesNotice(
        result.restartRequired
          ? "server.properties saved. Restart the server for changes to take effect."
          : "server.properties saved.",
      );
    } catch (saveError) {
      setServerPropertiesError(saveError instanceof Error ? saveError.message : "Unable to save server.properties");
    } finally {
      setServerPropertiesSaving(false);
    }
  };

  return (
    <section className="instances-layout">
      {error ? (
        <div className="status-banner status-banner-alert" role="alert">
          <span>{error}</span>
          <button type="button" className="status-banner-close" onClick={() => setError("")} aria-label="Dismiss alert">
            Close
          </button>
        </div>
      ) : null}
      {banner ? (
        <div className={`status-banner status-banner-${banner.tone}`} role="status">
          <span>{banner.message}</span>
          <button
            type="button"
            className="status-banner-close"
            onClick={() => setBanner(null)}
            aria-label="Dismiss notification"
          >
            Close
          </button>
        </div>
      ) : null}

      <section
        className="instances-workspace"
        style={{
          gridTemplateColumns: `${listPaneWidth}px minmax(0, 1fr)`,
        }}
      >
        <aside className="instances-list-pane">
          <div className="instances-list-pane-inner">
            {listLoading ? <p className="muted-copy">Loading instances...</p> : null}
            {!listLoading && instances.length === 0 ? (
              <p className="muted-copy">No instances exist yet. Start by creating one below.</p>
            ) : null}

            {!listLoading && instances.length > 0 ? (
              <div
                className="instance-list-shell"
                onClick={(event) => {
                  if (event.target === event.currentTarget) {
                    setSelectedInstanceId("");
                    setWorkspaceData(null);
                    setRightPaneMode("details");
                  }
                }}
              >
                <div className="instance-list-header" role="presentation">
                  <span>Instance Name</span>
                  <span>Status</span>
                  <span>Auto-update</span>
                  <span>Version</span>
                </div>
                <div className="instance-list">
                  {instances.map((instance) => {
                    const bdsInstall = instanceBdsStatuses[instance.id];
                    const installStatus = getBdsListStatus(instance, bdsInstall);
                    const runtimeStatus = getRuntimeListStatus(instance);
                    const autoUpdateStatus = getAutoUpdateListStatus(instance);
                    const versionStatus = getVersionListStatus(instance, bdsInstall, latestBdsVersion);

                    return (
                      <button
                        key={instance.id}
                        type="button"
                        className={selectedInstanceId === instance.id && rightPaneMode === "details" ? "instance-list-item active" : "instance-list-item"}
                        onClick={() => {
                          setSelectedInstanceId(instance.id);
                          setRightPaneMode("details");
                          setError("");
                        }}
                      >
                        <span className="instance-list-name">
                          <strong>{instance.friendlyName}</strong>
                          <small>{instance.bdsVersion}</small>
                        </span>
                        <span className={`instance-bds-status status-${runtimeStatus.toLowerCase().replace(/ /g, "-")}`}>
                          {runtimeStatus}
                        </span>
                        <span className={autoUpdateStatus === "Enabled" ? "instance-bds-status status-current" : "instance-bds-status status-not_installed"}>
                          {autoUpdateStatus}
                        </span>
                        <span
                          className={`instance-bds-status status-${(
                            versionStatus.startsWith("Update available")
                              ? "update-available"
                              : versionStatus.toLowerCase().replace(/ /g, "-")
                          )}`}
                          title={installStatus !== "Current" && installStatus !== "Update available" ? `Install state: ${installStatus}` : undefined}
                        >
                          {versionStatus}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}

            <div className="instances-list-footer">
              <button
                type="button"
                className="primary-button"
                onClick={() => {
                  setRightPaneMode("create");
                  setWorkspaceData(null);
                  setError("");
                }}
              >
                Create Instance
              </button>
            </div>
          </div>
          <div
            className="instances-divider"
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize instances workspace"
            onPointerDown={(event) => {
              dragState.current = {
                startX: event.clientX,
                startWidth: listPaneWidth,
              };
              document.body.classList.add("is-resizing");
            }}
          />
        </aside>

        <section className="instances-detail-pane">
          <div className="instances-detail-pane-inner">
            <div className="instances-detail-header">
              {rightPaneMode === "create" ? (
                <div>
                  <h2>Initial Instance Config</h2>
                </div>
              ) : (
                <div className="instances-tab-bar" role="tablist" aria-label="Instance workspace sections">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={activeTab === "overview"}
                    className={activeTab === "overview" ? "instances-tab active" : "instances-tab"}
                    onClick={() => setActiveTab("overview")}
                  >
                    Overview
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={activeTab === "properties"}
                    className={activeTab === "properties" ? "instances-tab active" : "instances-tab"}
                    onClick={() => setActiveTab("properties")}
                  >
                    Properties
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={activeTab === "addons"}
                    className={activeTab === "addons" ? "instances-tab active" : "instances-tab"}
                    onClick={() => setActiveTab("addons")}
                  >
                    Addons
                  </button>
                </div>
              )}
              {rightPaneMode === "details" && !detailsLoading && workspaceData ? (
                <div className="instances-control-bar">
                  <button
                    type="button"
                    className="icon-action icon-action-primary"
                    onClick={() => void handleRuntimeAction("start")}
                    disabled={actionInFlight !== "" || workspaceData.runtime.status === "running" || workspaceData.runtime.status === "starting"}
                    title="Start"
                    aria-label="Start"
                  >
                    <ActionIcon active={actionInFlight === "start"}>
                      <Play aria-hidden="true" />
                    </ActionIcon>
                  </button>
                  <button
                    type="button"
                    className="icon-action"
                    onClick={() => void handleRuntimeAction("stop")}
                    disabled={actionInFlight !== "" || workspaceData.runtime.status === "stopped" || workspaceData.runtime.status === "stopping"}
                    title="Stop"
                    aria-label="Stop"
                  >
                    <ActionIcon active={actionInFlight === "stop"}>
                      <Square aria-hidden="true" />
                    </ActionIcon>
                  </button>
                  <button
                    type="button"
                    className="icon-action"
                    onClick={() => void handleRuntimeAction("restart")}
                    disabled={actionInFlight !== "" || workspaceData.runtime.status === "stopped" || workspaceData.runtime.status === "stopping"}
                    title="Restart"
                    aria-label="Restart"
                  >
                    <ActionIcon active={actionInFlight === "restart"}>
                      <RotateCw aria-hidden="true" />
                    </ActionIcon>
                  </button>
                  <button
                    type="button"
                    className="icon-action"
                    onClick={() => void handleExportBackup()}
                    disabled={actionInFlight !== ""}
                    title="Backup"
                    aria-label="Backup"
                  >
                    <ActionIcon active={actionInFlight === "backup"}>
                      <Save aria-hidden="true" />
                    </ActionIcon>
                  </button>
                  <div className="instances-update-menu" ref={updateMenuRef}>
                    <button
                      type="button"
                      className="icon-action"
                      onClick={() => setUpdateMenuOpen((open) => !open)}
                      disabled={actionInFlight !== ""}
                      title="Update options"
                      aria-label="Update options"
                      aria-expanded={updateMenuOpen}
                      aria-haspopup="menu"
                    >
                      <ActionIcon active={actionInFlight === "check-update" || actionInFlight === "update"}>
                        <ArrowDownToLine aria-hidden="true" />
                      </ActionIcon>
                    </button>
                    {updateMenuOpen ? (
                      <div className="instances-update-menu-panel" role="menu" aria-label="Update options">
                        <button
                          type="button"
                          className="instances-update-menu-item"
                          onClick={() => void handleCheckForUpdates()}
                          disabled={actionInFlight !== ""}
                          role="menuitem"
                        >
                          Check for updates only
                        </button>
                        <button
                          type="button"
                          className="instances-update-menu-item"
                          onClick={() => void handleManualUpdate()}
                          disabled={actionInFlight !== ""}
                          role="menuitem"
                        >
                          Check and install updates
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>

            {rightPaneMode === "create" ? (
              <form className="form-grid instances-create-form" onSubmit={handleCreateInstance}>
                <label>
                  Friendly name
                  <input
                    value={createFriendlyName}
                    onChange={(event) => setCreateFriendlyName(event.target.value)}
                    placeholder="My survival realm"
                    minLength={1}
                    maxLength={64}
                  />
                </label>

                <div className="instances-toggle-row">
                  <div className="instances-toggle-copy">
                    <strong>Enable automatic updating</strong>
                    <span>
                      {automaticUpdatingEnabled
                        ? "Automatic updating enabled"
                        : "Automatic updating disabled"}
                    </span>
                  </div>

                  <button
                    type="button"
                    className={automaticUpdatingEnabled ? "toggle-switch active" : "toggle-switch"}
                    aria-pressed={automaticUpdatingEnabled}
                    onClick={() => setAutomaticUpdatingEnabled((enabled) => !enabled)}
                  >
                    <span className="toggle-switch-thumb" />
                  </button>
                </div>

                {automaticUpdatingEnabled ? (
                  <div className="instances-schedule-grid">
                    <label>
                      Check for updates
                      <select
                        value={updateCheckFrequency}
                        onChange={(event) => {
                          const value = event.target.value === "weekly" ? "weekly" : "daily";
                          setUpdateCheckFrequency(value);
                        }}
                      >
                        <option value="daily">Daily</option>
                        <option value="weekly">Weekly</option>
                      </select>
                    </label>

                    <label>
                      Check time
                      <input
                        type="time"
                        value={updateCheckTime}
                        onChange={(event) => setUpdateCheckTime(event.target.value)}
                      />
                    </label>

                    {updateCheckFrequency === "weekly" ? (
                      <label>
                        Check day
                        <select
                          value={updateCheckWeekday}
                          onChange={(event) => {
                            const value = event.target.value as typeof updateCheckWeekday;
                            setUpdateCheckWeekday(value);
                          }}
                        >
                          <option value="monday">Monday</option>
                          <option value="tuesday">Tuesday</option>
                          <option value="wednesday">Wednesday</option>
                          <option value="thursday">Thursday</option>
                          <option value="friday">Friday</option>
                          <option value="saturday">Saturday</option>
                          <option value="sunday">Sunday</option>
                        </select>
                      </label>
                    ) : null}
                  </div>
                ) : null}

                <div className="instances-inline-note">
                  New instances install the latest BDS build automatically during creation and remain stopped afterward.
                  When automatic updating is enabled, Chroma now stores the schedule and runs background update checks in the
                  configured app timezone.
                </div>

                <div className="instances-form-actions">
                  <button type="submit" className="primary-button" disabled={creatingInstance}>
                    {creatingInstance ? "Creating..." : "Create instance"}
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => {
                      setRightPaneMode("details");
                      setCreateFriendlyName("");
                      setAutomaticUpdatingEnabled(true);
                      setUpdateCheckFrequency("daily");
                      setUpdateCheckTime(DEFAULT_UPDATE_TIME);
                      setUpdateCheckWeekday(DEFAULT_UPDATE_WEEKDAY);
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            ) : null}

            {rightPaneMode === "details" && detailsLoading ? <p className="muted-copy">Loading selected instance...</p> : null}
            {rightPaneMode === "details" && !detailsLoading && !workspaceData ? (
              <p className="muted-copy">Select an instance from the left to inspect its configuration and runtime state.</p>
            ) : null}

            {rightPaneMode === "details" && !detailsLoading && workspaceData ? (
              <div className="instances-detail-body">
                <div className="instances-detail-toolbar">
                  <div className="instances-detail-toolbar-spacer" aria-hidden="true" />
                  <div className="instances-detail-toolbar-actions">
                    {activeTab === "overview" && !editingInstance ? (
                      <button type="button" className="secondary-button" onClick={() => setEditingInstance(true)}>
                        Edit
                      </button>
                    ) : null}

                    {activeTab === "properties" ? (
                      <button type="button" className="secondary-button" onClick={() => void openServerPropertiesEditor()}>
                        Edit
                      </button>
                    ) : null}
                  </div>
                </div>

                {activeTab === "overview" ? (
                  <div className="instance-details-sections">
                    <section className="instance-detail-section">
                      <dl className="instance-detail-list">
                        <div><dt>Name</dt><dd>{workspaceData.instance.friendlyName}</dd></div>
                        <div><dt>Automatic updates</dt><dd>{workspaceData.instance.automaticUpdatesEnabled ? "Enabled" : "Disabled"}</dd></div>
                        <div><dt>Frequency</dt><dd>{workspaceData.instance.updateCheckFrequency}</dd></div>
                        {workspaceData.instance.automaticUpdatesEnabled && workspaceData.instance.updateCheckFrequency === "weekly" ? (
                          <div><dt>Check day</dt><dd>{formatWeekday(workspaceData.instance.updateCheckWeekday)}</dd></div>
                        ) : null}
                        {workspaceData.instance.automaticUpdatesEnabled ? (
                          <div><dt>Check time</dt><dd>{workspaceData.instance.updateCheckTime}</dd></div>
                        ) : null}
                        <div><dt>Last check</dt><dd>{formatTimestamp(workspaceData.instance.lastAutoUpdateCheckAt)}</dd></div>
                      </dl>
                    </section>

                    <section className="instance-detail-section">
                      <dl className="instance-detail-list">
                        <div><dt>Path</dt><dd>{workspaceData.instance.instancePath}</dd></div>
                        <div><dt>Installed version</dt><dd>{workspaceData.bds.version ?? "Not installed"}</dd></div>
                        <div><dt>Runtime</dt><dd>{workspaceData.runtime.status}</dd></div>
                        <div><dt>PID</dt><dd>{workspaceData.runtime.pid ?? "Not running"}</dd></div>
                      </dl>
                    </section>
                  </div>
                ) : null}

                {activeTab === "properties" ? (
                  <div className="instance-details-sections instance-details-sections-single">
                    <section className="instance-detail-section">
                      {serverPropertiesLoading && !serverPropertiesData ? <p className="muted-copy">Loading server.properties...</p> : null}
                      {serverPropertiesData ? (
                        <dl className="instance-detail-list instance-detail-list-properties">
                          {parseServerPropertiesPreview(serverPropertiesData.content).map((entry) => (
                            <div key={entry.key}>
                              <dt>{entry.key}</dt>
                              <dd>{entry.value || " "}</dd>
                            </div>
                          ))}
                        </dl>
                      ) : null}
                    </section>
                  </div>
                ) : null}

                {activeTab === "addons" ? (
                  <div className="instance-details-sections instance-details-sections-single">
                    <section className="instance-detail-section">
                      <h3>Addons</h3>
                      <p className="muted-copy">Addon management will live here once the installation and enablement flow is ready.</p>
                    </section>
                  </div>
                ) : null}
              </div>
            ) : null}

            {serverPropertiesEditorOpen ? (
              <div className="instance-editor-drawer-layer">
                <button
                  type="button"
                  className="instance-editor-drawer-backdrop"
                  aria-label="Close BDS editor"
                  onClick={closeServerPropertiesEditor}
                />
                <aside className="instance-editor-drawer">
                  <div className="instance-editor-drawer-header">
                    <div>
                      <p className="eyebrow">BDS Editor</p>
                      <h3>server.properties</h3>
                    </div>
                  </div>

                  {serverPropertiesLoading ? <p className="muted-copy">Loading server.properties...</p> : null}
                  {serverPropertiesError ? <div className="form-error">{serverPropertiesError}</div> : null}
                  {serverPropertiesNotice ? <div className="instances-inline-note">{serverPropertiesNotice}</div> : null}

                  {!serverPropertiesLoading && serverPropertiesData ? (
                    <form className="server-properties-editor" onSubmit={handleSaveServerProperties}>
                      <label className="server-properties-textarea-shell">
                        <textarea
                          className="server-properties-textarea"
                          value={serverPropertiesData.content}
                          onChange={(event) => updateServerPropertiesContent(event.target.value)}
                          spellCheck={false}
                        />
                      </label>

                      <div className="instances-form-actions">
                        <button type="submit" className="primary-button" disabled={serverPropertiesSaving}>
                          {serverPropertiesSaving ? "Saving..." : "Save"}
                        </button>
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={closeServerPropertiesEditor}
                          disabled={serverPropertiesSaving}
                        >
                          Cancel
                        </button>
                      </div>
                    </form>
                  ) : null}
                </aside>
              </div>
            ) : null}

            {editingInstance && workspaceData ? (
              <div className="instance-editor-drawer-layer">
                <button
                  type="button"
                  className="instance-editor-drawer-backdrop"
                  aria-label="Close instance editor"
                  onClick={closeInstanceEditor}
                />
                <aside className="instance-editor-drawer">
                  <div className="instance-editor-drawer-header">
                    <div>
                      <p className="eyebrow">Instance Editor</p>
                      <h3>Overview</h3>
                    </div>
                  </div>

                  <form className="form-grid instances-create-form" onSubmit={handleSaveInstance}>
                    <label>
                      Instance name
                      <input
                        value={instanceEditor.friendlyName}
                        onChange={(event) => setInstanceEditor((current) => ({ ...current, friendlyName: event.target.value }))}
                      />
                    </label>

                    <div className="instances-toggle-row">
                      <div className="instances-toggle-copy">
                        <strong>Enable automatic updating</strong>
                        <span>
                          {instanceEditor.automaticUpdatesEnabled ? "Automatic updating enabled" : "Automatic updating disabled"}
                        </span>
                      </div>
                      <button
                        type="button"
                        className={instanceEditor.automaticUpdatesEnabled ? "toggle-switch active" : "toggle-switch"}
                        aria-pressed={instanceEditor.automaticUpdatesEnabled}
                        onClick={() =>
                          setInstanceEditor((current) => ({
                            ...current,
                            automaticUpdatesEnabled: !current.automaticUpdatesEnabled,
                          }))
                        }
                      >
                        <span className="toggle-switch-thumb" />
                      </button>
                    </div>

                    {instanceEditor.automaticUpdatesEnabled ? (
                      <div className="instances-schedule-grid">
                        <label>
                          Check for updates
                          <select
                            value={instanceEditor.updateCheckFrequency}
                            onChange={(event) =>
                              setInstanceEditor((current) => ({
                                ...current,
                                updateCheckFrequency: event.target.value === "weekly" ? "weekly" : "daily",
                              }))
                            }
                          >
                            <option value="daily">Daily</option>
                            <option value="weekly">Weekly</option>
                          </select>
                        </label>

                        <label>
                          Check time
                          <input
                            type="time"
                            value={instanceEditor.updateCheckTime}
                            onChange={(event) =>
                              setInstanceEditor((current) => ({ ...current, updateCheckTime: event.target.value }))
                            }
                          />
                        </label>

                        {instanceEditor.updateCheckFrequency === "weekly" ? (
                          <label>
                            Check day
                            <select
                              value={instanceEditor.updateCheckWeekday}
                              onChange={(event) =>
                                setInstanceEditor((current) => ({
                                  ...current,
                                  updateCheckWeekday: event.target.value as InstanceEditorState["updateCheckWeekday"],
                                }))
                              }
                          >
                            <option value="monday">Monday</option>
                            <option value="tuesday">Tuesday</option>
                            <option value="wednesday">Wednesday</option>
                            <option value="thursday">Thursday</option>
                            <option value="friday">Friday</option>
                            <option value="saturday">Saturday</option>
                            <option value="sunday">Sunday</option>
                          </select>
                        </label>
                        ) : null}
                      </div>
                    ) : null}

                    <div className="instances-form-actions">
                      <button type="submit" className="primary-button" disabled={savingInstance}>
                        {savingInstance ? "Saving..." : "Save"}
                      </button>
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={closeInstanceEditor}
                        disabled={savingInstance}
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                </aside>
              </div>
            ) : null}
          </div>
        </section>
      </section>
    </section>
  );
};

export default InstancesPage;
