import { ArrowDownToLine, LoaderCircle, Play, RotateCw, Save, Square, SquarePen, Terminal } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type {
  BdsStartValidationResult,
  BdsConsoleLine,
  BdsInstall,
  BdsRuntimeState,
  BedrockServerSettings,
  Instance,
  InstanceBdsLogFileSummary,
  InstanceRuntimeEvent,
} from "../../../shared/types/index.js";
import {
  ApiRequestError,
  createInstance,
  createExportBackup,
  getInstance,
  getInstanceBdsLogFiles,
  getInstanceBdsLogPage,
  getInstanceBdsRuntime,
  getInstanceBdsStatus,
  getInstanceCurrentBdsLogTail,
  getInstances,
  getInstanceRuntimeEvents,
  getInstanceServerProperties,
  getInstanceSettings,
  checkInstanceBdsUpdates,
  getLatestBdsVersion,
  manualUpdateInstanceBds,
  restartInstanceBds,
  sendInstanceConsoleCommand,
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
  events: InstanceRuntimeEvent[];
};

type RightPaneMode = "details" | "create";
type RightPaneTab = "overview" | "properties" | "logs" | "addons";
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

type ConsoleSessionState = {
  lines: BdsConsoleLine[];
  runtime: BdsRuntimeState | null;
  liveOutput: boolean;
  canWrite: boolean;
};

type LogViewerState = {
  files: InstanceBdsLogFileSummary[];
  selectedFileName: string;
  lines: string[];
  offset: number;
  limit: number;
  totalLines: number;
  hasPrevious: boolean;
  hasNext: boolean;
  tailView: boolean;
};

type BannerTone = "info" | "warning" | "error";

type BannerState = {
  message: string;
  tone: BannerTone;
};

type WorkspaceNoticeTone = "info" | "warning" | "error";

type WorkspaceNotice = {
  id: string;
  tone: WorkspaceNoticeTone;
  title: string;
  message: string;
};

function formatLabel(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .split(" ")
    .filter((part) => part !== "")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatTimestamp(value?: string): string {
  if (!value) {
    return "Pending";
  }

  return new Date(value).toLocaleString();
}

function formatWeekday(value: string): string {
  return formatLabel(value);
}

function formatBytes(value: number): string {
  if (value < 1024) {
    return `${value} B`;
  }

  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }

  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function formatEventAction(value: string): string {
  return formatLabel(value);
}

function getLastCheckSummary(instance: Instance): { result: string; timestamp: string } {
  if (instance.lastCheckAt && instance.lastCheckResult) {
    return {
      result: instance.lastCheckResult,
      timestamp: formatTimestamp(instance.lastCheckAt),
    };
  }

  return {
    result: "Success",
    timestamp: formatTimestamp(instance.createdAt),
  };
}

function getEventToneClass(level: InstanceRuntimeEvent["level"]): string {
  if (level === "error") {
    return "status-error";
  }

  if (level === "warning") {
    return "status-warning";
  }

  return "status-info";
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
const LIST_PANE_WIDTH_PX = 525;

function ActionIcon({ active, children }: { active: boolean; children: ReactNode }) {
  if (active) {
    return <LoaderCircle className="icon-action-spinner" aria-hidden="true" />;
  }

  return <>{children}</>;
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
  return formatLabel(instance.status);
}

function getAutoUpdateListStatus(instance: Instance): string {
  return instance.automaticUpdatesEnabled ? "Auto" : "Manual";
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

  return "Update Available";
}

function getRuntimeStatusSummary(runtime: BdsRuntimeState): string {
  if (runtime.status === "unknown") {
    return "Unknown";
  }

  if (runtime.status === "starting" && runtime.healthStatus === "pending") {
    return "Start In Progress";
  }

  if (runtime.status === "running" && runtime.healthStatus === "unknown") {
    return "Running (Unverified)";
  }

  if (runtime.healthStatus === "degraded") {
    return `${formatLabel(runtime.status)} (Degraded)`;
  }

  return formatLabel(runtime.status);
}

function getWorkspaceNoticeToneClass(tone: WorkspaceNoticeTone): string {
  if (tone === "warning") {
    return "workspace-notice-warning";
  }

  if (tone === "error") {
    return "workspace-notice-error";
  }

  return "workspace-notice-info";
}

function buildWorkspaceNotices(
  workspaceData: InstanceWorkspaceData | null,
  latestBdsVersion: string,
  validation: BdsStartValidationResult | null,
): WorkspaceNotice[] {
  if (!workspaceData) {
    return [];
  }

  const notices: WorkspaceNotice[] = [];
  const { instance, runtime, bds } = workspaceData;

  if (validation) {
    for (const issue of validation.errors) {
      notices.push({
        id: `validation-error-${issue.code}-${issue.message}`,
        tone: "error",
        title: "Start blocked",
        message: issue.message,
      });
    }

    for (const issue of validation.warnings) {
      notices.push({
        id: `validation-warning-${issue.code}-${issue.message}`,
        tone: "warning",
        title: "Start warning",
        message: issue.message,
      });
    }
  }

  if (runtime.maintenanceStatus !== "idle") {
    notices.push({
      id: `maintenance-${runtime.maintenanceStatus}`,
      tone: "warning",
      title: `${formatLabel(runtime.maintenanceStatus)} in progress`,
      message: runtime.message ?? "Chroma is currently performing a managed maintenance workflow for this instance.",
    });
  } else if (runtime.healthStatus === "degraded") {
    notices.push({
      id: "runtime-degraded",
      tone: "warning",
      title: "Runtime degraded",
      message:
        runtime.message ??
        "The instance is running, but Chroma does not currently have a fully healthy runtime control channel for it.",
    });
  } else if (runtime.status === "unknown") {
    notices.push({
      id: "runtime-unknown",
      tone: "error",
      title: "Runtime unknown",
      message:
        runtime.message ??
        "Chroma cannot currently confirm this runtime state. Review recent activity and logs before taking further action.",
    });
  } else if (runtime.status === "error") {
    notices.push({
      id: "runtime-error",
      tone: "error",
      title: "Runtime error",
      message: runtime.message ?? "The instance encountered a runtime error. Review recent activity and logs for more detail.",
    });
  }

  if (bds.status === "error") {
    notices.push({
      id: "install-error",
      tone: "error",
      title: "BDS install error",
      message: bds.error ?? "BDS is not currently in a healthy installed state for this instance.",
    });
  }

  if (latestBdsVersion && instance.bdsVersion !== latestBdsVersion) {
    notices.push({
      id: `update-available-${latestBdsVersion}`,
      tone: "info",
      title: "Update available",
      message: `This instance is on ${instance.bdsVersion}. The latest available BDS version is ${latestBdsVersion}.`,
    });
  }

  return notices;
}

const InstancesPage = () => {
  const updateMenuRef = useRef<HTMLDivElement | null>(null);
  const consoleEventSourceRef = useRef<EventSource | null>(null);
  const consoleOutputRef = useRef<HTMLDivElement | null>(null);
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
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [consoleConnecting, setConsoleConnecting] = useState(false);
  const [consoleSession, setConsoleSession] = useState<ConsoleSessionState>({
    lines: [],
    runtime: null,
    liveOutput: false,
    canWrite: false,
  });
  const [consoleCommand, setConsoleCommand] = useState("");
  const [consoleCommandSending, setConsoleCommandSending] = useState(false);
  const [consoleError, setConsoleError] = useState("");
  const [logsLoading, setLogsLoading] = useState(false);
  const [logViewer, setLogViewer] = useState<LogViewerState>({
    files: [],
    selectedFileName: "",
    lines: [],
    offset: 0,
    limit: 200,
    totalLines: 0,
    hasPrevious: false,
    hasNext: false,
    tailView: true,
  });
  const [logViewerError, setLogViewerError] = useState("");
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
  const [error, setError] = useState("");
  const [startValidationFeedback, setStartValidationFeedback] = useState<BdsStartValidationResult | null>(null);
  const [dismissedWorkspaceNoticeIds, setDismissedWorkspaceNoticeIds] = useState<string[]>([]);

  const canStartSelectedInstance =
    workspaceData !== null &&
    actionInFlight === "" &&
    workspaceData.runtime.status !== "running" &&
    workspaceData.runtime.status !== "starting" &&
    workspaceData.runtime.status !== "unknown" &&
    workspaceData.runtime.desiredStatus !== "running";
  const canStopSelectedInstance =
    workspaceData !== null &&
    actionInFlight === "" &&
    workspaceData.runtime.isProcessActive &&
    workspaceData.runtime.status !== "stopping";
  const canRestartSelectedInstance =
    workspaceData !== null &&
    actionInFlight === "" &&
    workspaceData.runtime.isProcessActive &&
    workspaceData.runtime.status !== "stopping";
  const workspaceNotices = buildWorkspaceNotices(workspaceData, latestBdsVersion, startValidationFeedback).filter(
    (notice) => !dismissedWorkspaceNoticeIds.includes(notice.id),
  );

  async function loadInstances(preferredInstanceId?: string) {
    setListLoading(true);
    setError("");
    setStartValidationFeedback(null);

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
        const [instanceResult, settingsResult, bdsResult, runtimeResult, eventsResult] = await Promise.all([
          getInstance(selectedInstanceId),
          getInstanceSettings(selectedInstanceId),
          getInstanceBdsStatus(selectedInstanceId),
          getInstanceBdsRuntime(selectedInstanceId),
          getInstanceRuntimeEvents(selectedInstanceId),
        ]);

        setWorkspaceData({
          instance: instanceResult.instance,
          settings: settingsResult.settings,
          bds: bdsResult.bds,
          runtime: runtimeResult.runtime,
          events: eventsResult.events,
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
      setUpdateMenuOpen(false);
      setEditingInstance(false);
      setConsoleOpen(false);
      setLogViewer({
        files: [],
        selectedFileName: "",
        lines: [],
        offset: 0,
        limit: 200,
        totalLines: 0,
        hasPrevious: false,
        hasNext: false,
        tailView: true,
      });
      setLogViewerError("");
    }
  }, [rightPaneMode, selectedInstanceId]);

  useEffect(() => {
    if (!consoleOpen || !selectedInstanceId) {
      consoleEventSourceRef.current?.close();
      consoleEventSourceRef.current = null;
      setConsoleConnecting(false);
      setConsoleError("");
      setConsoleSession({
        lines: [],
        runtime: null,
        liveOutput: false,
        canWrite: false,
      });
      return;
    }

    setConsoleConnecting(true);
    setConsoleError("");

    const eventSource = new EventSource(`/api/instances/${selectedInstanceId}/bds/console/stream`);
    consoleEventSourceRef.current = eventSource;

    eventSource.onopen = () => {
      setConsoleConnecting(false);
      setConsoleError("");
    };

    eventSource.addEventListener("snapshot", (event) => {
      const payload = JSON.parse((event as MessageEvent<string>).data) as ConsoleSessionState;
      setConsoleSession(payload);
      setConsoleConnecting(false);
    });

    eventSource.addEventListener("line", (event) => {
      const payload = JSON.parse((event as MessageEvent<string>).data) as BdsConsoleLine;
      setConsoleSession((current) => ({
        ...current,
        lines: [...current.lines, payload].slice(-300),
      }));
    });

    eventSource.addEventListener("status", (event) => {
      const payload = JSON.parse((event as MessageEvent<string>).data) as ConsoleSessionState;
      setConsoleSession((current) => ({
        ...current,
        runtime: payload.runtime,
        liveOutput: payload.liveOutput,
        canWrite: payload.canWrite,
      }));
    });

    eventSource.onerror = () => {
      setConsoleConnecting(true);
      setConsoleError("Console connection interrupted. Chroma is attempting to reconnect.");
    };

    return () => {
      eventSource.close();
      if (consoleEventSourceRef.current === eventSource) {
        consoleEventSourceRef.current = null;
      }
    };
  }, [consoleOpen, selectedInstanceId]);

  useEffect(() => {
    if (!consoleOpen || !consoleOutputRef.current) {
      return;
    }

    consoleOutputRef.current.scrollTop = consoleOutputRef.current.scrollHeight;
  }, [consoleOpen, consoleSession.lines]);

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
    setDismissedWorkspaceNoticeIds([]);
  }, [rightPaneMode, selectedInstanceId]);

  useEffect(() => {
    if (rightPaneMode !== "details" || activeTab !== "logs" || !selectedInstanceId) {
      return;
    }

    void loadBdsLogs(selectedInstanceId, { mode: "tail" });
  }, [activeTab, rightPaneMode, selectedInstanceId]);

  useEffect(() => {
    if (rightPaneMode !== "details" || activeTab !== "properties" || !selectedInstanceId || serverPropertiesData || serverPropertiesLoading) {
      return;
    }

    void openServerPropertiesEditor(true);
  }, [activeTab, rightPaneMode, selectedInstanceId, serverPropertiesData, serverPropertiesLoading]);

  useEffect(() => {
    if (!selectedInstanceId) {
      return;
    }

    if (actionInFlight !== "backup" && actionInFlight !== "update") {
      return;
    }

    const timer = window.setInterval(() => {
      void loadInstances(selectedInstanceId);
      void refreshSelectedInstance(selectedInstanceId);
    }, 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, [actionInFlight, selectedInstanceId]);

  async function refreshSelectedInstance(instanceId: string) {
    const [instanceResult, settingsResult, bdsResult, runtimeResult, eventsResult] = await Promise.all([
      getInstance(instanceId),
      getInstanceSettings(instanceId),
      getInstanceBdsStatus(instanceId),
      getInstanceBdsRuntime(instanceId),
      getInstanceRuntimeEvents(instanceId),
    ]);

    setWorkspaceData({
      instance: instanceResult.instance,
      settings: settingsResult.settings,
      bds: bdsResult.bds,
      runtime: runtimeResult.runtime,
      events: eventsResult.events,
    });
    setInstanceEditor({
      friendlyName: instanceResult.instance.friendlyName,
      automaticUpdatesEnabled: instanceResult.instance.automaticUpdatesEnabled,
      updateCheckFrequency: instanceResult.instance.updateCheckFrequency,
      updateCheckTime: instanceResult.instance.updateCheckTime,
      updateCheckWeekday: instanceResult.instance.updateCheckWeekday,
    });
  }

  async function loadBdsLogs(
    instanceId: string,
    options?: { mode: "tail" } | { mode: "page"; fileName: string; offset?: number },
  ) {
    setLogsLoading(true);
    setLogViewerError("");

    try {
      const filesResult = await getInstanceBdsLogFiles(instanceId);
      const files = filesResult.files;
      const currentFile = files.find((file) => file.current)?.fileName ?? "";
      if (!options || options.mode === "tail") {
        const tail = await getInstanceCurrentBdsLogTail(instanceId, 200);
        setLogViewer({
          files,
          selectedFileName: tail.fileName || currentFile,
          lines: tail.lines,
          offset: 0,
          limit: 200,
          totalLines: tail.lines.length,
          hasPrevious: false,
          hasNext: false,
          tailView: true,
        });
        return;
      }

      const page = await getInstanceBdsLogPage(instanceId, options.fileName, {
        offset: options.offset ?? 0,
        limit: 200,
      });

      setLogViewer({
        files,
        selectedFileName: page.fileName,
        lines: page.lines,
        offset: page.offset,
        limit: page.limit,
        totalLines: page.totalLines,
        hasPrevious: page.hasPrevious,
        hasNext: page.hasNext,
        tailView: page.fileName === currentFile && page.offset + page.lines.length >= page.totalLines,
      });
    } catch (loadError) {
      setLogViewerError(loadError instanceof Error ? loadError.message : "Unable to load BDS logs");
    } finally {
      setLogsLoading(false);
    }
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

  const closeConsole = () => {
    if (consoleCommandSending) {
      return;
    }

    setConsoleOpen(false);
    setConsoleCommand("");
    setConsoleError("");
  };

  const handleSendConsoleCommand = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!selectedInstanceId || consoleCommand.trim() === "") {
      return;
    }

    setConsoleCommandSending(true);
    setConsoleError("");

    try {
      await sendInstanceConsoleCommand(selectedInstanceId, {
        command: consoleCommand.trim(),
      });
      setConsoleCommand("");
      await refreshSelectedInstance(selectedInstanceId);
    } catch (sendError) {
      setConsoleError(sendError instanceof Error ? sendError.message : "Unable to send console command");
    } finally {
      setConsoleCommandSending(false);
    }
  };

  const handleRuntimeAction = async (action: "start" | "stop" | "restart") => {
    if (!selectedInstanceId) {
      return;
    }

    setActionInFlight(action);
    setError("");
    setBanner(null);
    if (action === "start") {
      setStartValidationFeedback(null);
    }

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
      if (action === "start" && actionError instanceof ApiRequestError && actionError.validation) {
        setStartValidationFeedback(actionError.validation);
      }
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
      const result = await checkInstanceBdsUpdates(selectedInstanceId);
      setLatestBdsVersion(result.latestVersion ?? "");
      await loadInstances(selectedInstanceId);
      await refreshSelectedInstance(selectedInstanceId);

      if (!result.latestVersion) {
        setBanner({ message: "Unable to determine the latest BDS version right now.", tone: "warning" });
        return;
      }

      if (!result.updateAvailable) {
        setBanner({ message: `No updates available. This instance is already on ${result.latestVersion}.`, tone: "info" });
        return;
      }

      setBanner({
        message: `Update available: ${result.latestVersion}. Current instance version: ${result.currentVersion}.`,
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
        setBanner({ message: `No updates available. This instance is already on ${latestResult.version}.`, tone: "info" });
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
        tone: "info",
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
    } catch (saveError) {
      setServerPropertiesError(saveError instanceof Error ? saveError.message : "Unable to save server.properties");
    } finally {
      setServerPropertiesSaving(false);
    }
  };

  return (
    <section className="instances-layout">
      {error ? (
        <div className="status-banner status-banner-error" role="alert">
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
          gridTemplateColumns: `${LIST_PANE_WIDTH_PX}px minmax(0, 1fr)`,
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
                    setStartValidationFeedback(null);
                  }
                }}
              >
                <div className="instance-list-header" role="presentation">
                  <span>Instance Name</span>
                  <span>Status</span>
                  <span>Updates</span>
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
                          setStartValidationFeedback(null);
                        }}
                      >
                        <span className="instance-list-name">
                          <strong>{instance.friendlyName}</strong>
                          <small>{instance.bdsVersion}</small>
                        </span>
                        <span className={`instance-list-status status-${runtimeStatus.toLowerCase().replace(/ /g, "-")}`}>
                          {runtimeStatus}
                        </span>
                        <span className={autoUpdateStatus === "Auto" ? "instance-list-status status-current" : "instance-list-status status-not_installed"}>
                          {autoUpdateStatus}
                        </span>
                        <span
                          className={`instance-list-status status-${(
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
            aria-label="Instances workspace divider"
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
                    aria-selected={activeTab === "logs"}
                    className={activeTab === "logs" ? "instances-tab active" : "instances-tab"}
                    onClick={() => setActiveTab("logs")}
                  >
                    Logs
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
                    disabled={!canStartSelectedInstance}
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
                    disabled={!canStopSelectedInstance}
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
                    disabled={!canRestartSelectedInstance}
                    title="Restart"
                    aria-label="Restart"
                  >
                    <ActionIcon active={actionInFlight === "restart"}>
                      <RotateCw aria-hidden="true" />
                    </ActionIcon>
                  </button>
                  {activeTab === "overview" ? (
                    <button
                      type="button"
                      className="icon-action"
                      onClick={() => setEditingInstance(true)}
                      title="Edit overview"
                      aria-label="Edit overview"
                    >
                      <SquarePen aria-hidden="true" />
                    </button>
                  ) : null}
                  {activeTab === "properties" ? (
                    <button
                      type="button"
                      className="icon-action"
                      onClick={() => void openServerPropertiesEditor()}
                      title="Edit server.properties"
                      aria-label="Edit server.properties"
                    >
                      <SquarePen aria-hidden="true" />
                    </button>
                  ) : null}
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
                  <button
                    type="button"
                    className="icon-action"
                    onClick={() => {
                      setConsoleOpen(true);
                      setConsoleError("");
                    }}
                    title="Console"
                    aria-label="Console"
                  >
                    <Terminal aria-hidden="true" />
                  </button>
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
                {activeTab === "overview" ? (
                  <div className="instance-overview-stack">
                    <div className="instance-overview-summary">
                      {workspaceNotices.length > 0 ? (
                        <section className="workspace-notice-stack" aria-label="Instance runtime summary">
                          {workspaceNotices.map((notice) => (
                            <article key={notice.id} className={`workspace-notice ${getWorkspaceNoticeToneClass(notice.tone)}`}>
                              <div className="workspace-notice-copy">
                                <strong>{notice.title}</strong>
                                <p>{notice.message}</p>
                              </div>
                              <button
                                type="button"
                                className="workspace-notice-close"
                                onClick={() =>
                                  setDismissedWorkspaceNoticeIds((current) =>
                                    current.includes(notice.id) ? current : [...current, notice.id],
                                  )
                                }
                                aria-label={`Dismiss ${notice.title}`}
                              >
                                Close
                              </button>
                            </article>
                          ))}
                        </section>
                      ) : null}
                      <div className="instance-details-sections instance-overview-details">
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
                          <div>
                            <dt>Last check</dt>
                            <dd className="instance-last-check">
                              <span>{getLastCheckSummary(workspaceData.instance).result}</span>
                              <small>{getLastCheckSummary(workspaceData.instance).timestamp}</small>
                            </dd>
                          </div>
                        </dl>
                      </section>

                      <section className="instance-detail-section">
                        <dl className="instance-detail-list">
                          <div><dt>Installed version</dt><dd>{workspaceData.bds.version ?? "Not installed"}</dd></div>
                          <div><dt>Status</dt><dd>{getRuntimeStatusSummary(workspaceData.runtime)}</dd></div>
                          <div><dt>Health</dt><dd>{formatLabel(workspaceData.runtime.healthStatus)}</dd></div>
                          <div><dt>PID</dt><dd>{workspaceData.runtime.pid ?? "Not running"}</dd></div>
                          <div><dt>Path</dt><dd>{workspaceData.instance.instancePath}</dd></div>
                        </dl>
                      </section>
                    </div>
                    </div>

                    <section className="instance-detail-section instance-detail-section-wide instance-overview-activity">
                      <div className="instance-detail-section-header">
                        <h3>Recent activity</h3>
                      </div>
                      <div className="instance-overview-activity-body">
                        {workspaceData.events.length === 0 ? (
                          <p className="muted-copy">No instance activity has been recorded yet.</p>
                        ) : (
                          <div className="instance-event-table" role="table" aria-label="Instance activity">
                            <div className="instance-event-table-header" role="row">
                              <span role="columnheader">Level</span>
                              <span role="columnheader">Action</span>
                              <span role="columnheader">Time</span>
                              <span role="columnheader">Message</span>
                            </div>
                            {workspaceData.events.map((event) => (
                              <article key={event.id} className="instance-event-table-row" role="row">
                                <span className={`instance-bds-status ${getEventToneClass(event.level)}`} role="cell">
                                  {formatLabel(event.level)}
                                </span>
                                <span className="instance-event-action" role="cell">{formatEventAction(event.action)}</span>
                                <time className="instance-event-time" dateTime={event.createdAt} role="cell">
                                  {formatTimestamp(event.createdAt)}
                                </time>
                                <span className="instance-event-message" role="cell">{event.message}</span>
                              </article>
                            ))}
                          </div>
                        )}
                      </div>
                    </section>
                  </div>
                ) : null}

                {activeTab === "properties" ? (
                  <div className="instance-details-sections instance-details-sections-single">
                    <section className="instance-detail-section">
                      {serverPropertiesData?.restartRequired ? (
                        <div className="instances-inline-note">
                          Saving <code>server.properties</code> while the instance is running requires a restart before the changes take effect.
                        </div>
                      ) : null}
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

                {activeTab === "logs" ? (
                  <div className="instance-details-sections instance-details-sections-single">
                    <section className="instance-detail-section">
                      <div className="instance-detail-section-header">
                        <h3>Raw BDS logs</h3>
                        <div className="instance-log-toolbar">
                          <button
                            type="button"
                            className="secondary-button"
                            onClick={() => void loadBdsLogs(selectedInstanceId, { mode: "tail" })}
                            disabled={logsLoading}
                          >
                            Current tail
                          </button>
                          <button
                            type="button"
                            className="secondary-button"
                            onClick={() =>
                              logViewer.selectedFileName
                                ? void loadBdsLogs(selectedInstanceId, {
                                    mode: "page",
                                    fileName: logViewer.selectedFileName,
                                    offset: logViewer.offset,
                                  })
                                : undefined
                            }
                            disabled={logsLoading || !logViewer.selectedFileName}
                          >
                            Refresh
                          </button>
                        </div>
                      </div>

                      {logViewerError ? <div className="form-error">{logViewerError}</div> : null}
                      {logsLoading ? <p className="muted-copy">Loading logs...</p> : null}

                      {!logsLoading ? (
                        <div className="instance-log-layout">
                          <aside className="instance-log-file-list">
                            {logViewer.files.length === 0 ? (
                              <p className="muted-copy">No BDS log files exist yet.</p>
                            ) : (
                              logViewer.files.map((file) => (
                                <button
                                  key={file.fileName}
                                  type="button"
                                  className={logViewer.selectedFileName === file.fileName ? "instance-log-file active" : "instance-log-file"}
                                  onClick={() =>
                                    file.current
                                      ? void loadBdsLogs(selectedInstanceId, { mode: "tail" })
                                      : void loadBdsLogs(selectedInstanceId, { mode: "page", fileName: file.fileName, offset: 0 })
                                  }
                                >
                                  <strong>{file.current ? "Current log" : file.fileName}</strong>
                                  <small>{formatBytes(file.sizeBytes)} • {formatTimestamp(file.updatedAt)}</small>
                                </button>
                              ))
                            )}
                          </aside>

                          <div className="instance-log-viewer-shell">
                            <div className="instance-log-viewer-meta">
                              <span className="instance-bds-status status-current">
                                {logViewer.tailView ? "Tail view" : "Paged view"}
                              </span>
                              <span className="muted-copy">
                                {logViewer.selectedFileName || "No file selected"}
                              </span>
                            </div>

                            <div className="instance-log-viewer">
                              {logViewer.lines.length === 0 ? (
                                <p className="muted-copy">No log lines are available for this selection.</p>
                              ) : (
                                <pre className="instance-log-text">{logViewer.lines.join("\n")}</pre>
                              )}
                            </div>

                            {!logViewer.tailView ? (
                              <div className="instance-log-pagination">
                                <button
                                  type="button"
                                  className="secondary-button"
                                  onClick={() =>
                                    void loadBdsLogs(selectedInstanceId, {
                                      mode: "page",
                                      fileName: logViewer.selectedFileName,
                                      offset: Math.max(0, logViewer.offset - logViewer.limit),
                                    })
                                  }
                                  disabled={logsLoading || !logViewer.hasPrevious}
                                >
                                  Previous
                                </button>
                                <span className="muted-copy">
                                  Lines {logViewer.offset + 1}-{logViewer.offset + logViewer.lines.length} of {logViewer.totalLines}
                                </span>
                                <button
                                  type="button"
                                  className="secondary-button"
                                  onClick={() =>
                                    void loadBdsLogs(selectedInstanceId, {
                                      mode: "page",
                                      fileName: logViewer.selectedFileName,
                                      offset: logViewer.offset + logViewer.limit,
                                    })
                                  }
                                  disabled={logsLoading || !logViewer.hasNext}
                                >
                                  Next
                                </button>
                              </div>
                            ) : null}
                          </div>
                        </div>
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

            {consoleOpen ? (
              <div className="instance-editor-drawer-layer">
                <button
                  type="button"
                  className="instance-editor-drawer-backdrop"
                  aria-label="Close console"
                  onClick={closeConsole}
                />
                <aside className="instance-editor-drawer instance-console-drawer">
                  <div className="instance-editor-drawer-header">
                    <div>
                      <p className="eyebrow">BDS Console</p>
                      <h3>{workspaceData?.instance.friendlyName ?? "Instance console"}</h3>
                    </div>
                  </div>

                  <div className="instance-console-meta">
                    <span className={`instance-bds-status ${consoleSession.canWrite ? "status-current" : "status-warning"}`}>
                      {consoleSession.canWrite ? "Live command channel ready" : "Read-only"}
                    </span>
                    <span className={`instance-bds-status ${consoleSession.liveOutput ? "status-running" : "status-degraded"}`}>
                      {consoleSession.liveOutput ? "Live output connected" : "No live output"}
                    </span>
                  </div>

                  {consoleConnecting ? <p className="muted-copy">Connecting to the shared console stream...</p> : null}
                  {consoleSession.runtime?.message ? <div className="instances-inline-note">{consoleSession.runtime.message}</div> : null}
                  {consoleError ? <div className="form-error">{consoleError}</div> : null}

                  <div ref={consoleOutputRef} className="instance-console-output" role="log" aria-live="polite" aria-relevant="additions text">
                    {consoleSession.lines.length === 0 ? (
                      <p className="muted-copy">No console output has been captured for this session yet.</p>
                    ) : (
                      consoleSession.lines.map((line) => (
                        <div key={line.id} className={`instance-console-line source-${line.source}`}>
                          <time className="instance-console-line-time" dateTime={line.createdAt}>
                            {new Date(line.createdAt).toLocaleTimeString()}
                          </time>
                          <span className="instance-console-line-source">{line.source}</span>
                          <span className="instance-console-line-text">{line.text}</span>
                        </div>
                      ))
                    )}
                  </div>

                  <form className="instance-console-form" onSubmit={handleSendConsoleCommand}>
                    <input
                      value={consoleCommand}
                      onChange={(event) => setConsoleCommand(event.target.value)}
                      placeholder={
                        consoleSession.canWrite
                          ? "Enter a BDS command"
                          : "Console commands are unavailable until the instance is running under live Chroma management"
                      }
                      disabled={!consoleSession.canWrite || consoleCommandSending}
                      spellCheck={false}
                    />
                    <div className="instances-form-actions">
                      <button
                        type="submit"
                        className="primary-button"
                        disabled={!consoleSession.canWrite || consoleCommandSending || consoleCommand.trim() === ""}
                      >
                        {consoleCommandSending ? "Sending..." : "Send"}
                      </button>
                      <button type="button" className="secondary-button" onClick={closeConsole} disabled={consoleCommandSending}>
                        Close
                      </button>
                    </div>
                  </form>
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
