import { chmod, mkdir, stat } from "node:fs/promises";
import { basename } from "node:path";
import { spawn, ChildProcessWithoutNullStreams } from "node:child_process";
import type { BdsConsoleLine, BdsConsoleSnapshot } from "../../shared/types/index.js";
import type { Instance } from "../../shared/types/index.js";
import type { BdsRuntimeState } from "../../shared/types/bdsRuntime.js";
import {
  inspectRediscoverableProcess,
  readRuntimeHandle,
  removeRuntimeHandle,
  writeRuntimeHandle,
} from "./bdsRuntimeHandleService.js";
import { createId } from "../utils/createId.js";
import { appendBdsLogChunk, prepareBdsCurrentLog } from "./bdsLogService.js";

const BDS_EXECUTABLE_NAME = "bedrock_server";
const STOP_TIMEOUT_MS = 30000;
const TERM_TIMEOUT_MS = 10000;
const START_VERIFICATION_WINDOW_MS = 5000;
const RECENT_LOG_TAIL_LIMIT = 12;
const CONSOLE_SCROLLBACK_LIMIT = 300;

type ConsoleListener = (event: { type: "line"; line: BdsConsoleLine } | { type: "status"; snapshot: BdsConsoleSnapshot }) => void;
type RuntimeStateListener = (runtimeState: BdsRuntimeState, previousState?: BdsRuntimeState) => void;

function buildRuntimeState(
  instanceId: string,
  overrides: Partial<BdsRuntimeState> & Pick<BdsRuntimeState, "status" | "desiredStatus" | "healthStatus">,
): BdsRuntimeState {
  return {
    instanceId,
    maintenanceStatus: "idle",
    observedAt: new Date().toISOString(),
    isProcessActive: false,
    recentLogTail: undefined,
    ...overrides,
  };
}

export class BdsProcessManager {
  private processes = new Map<string, ChildProcessWithoutNullStreams>();
  private runtimeStates = new Map<string, BdsRuntimeState>();
  private recentLogTails = new Map<string, string[]>();
  private instances = new Map<string, Instance>();
  private consoleBuffers = new Map<string, BdsConsoleLine[]>();
  private consoleListeners = new Map<string, Set<ConsoleListener>>();
  private runtimeStateListeners = new Set<RuntimeStateListener>();
  private currentLogSizes = new Map<string, number>();
  private logWriteChains = new Map<string, Promise<void>>();

  async start(instance: Instance): Promise<BdsRuntimeState> {
    this.instances.set(instance.id, instance);
    const existing = this.runtimeStates.get(instance.id);

    if (existing && (this.processes.has(instance.id) || existing.isProcessActive)) {
      return buildRuntimeState(instance.id, {
        status: existing.status,
        desiredStatus: existing.desiredStatus,
        healthStatus: existing?.healthStatus ?? "unknown",
        maintenanceStatus: existing?.maintenanceStatus ?? "idle",
        isProcessActive: true,
        recentLogTail: existing.recentLogTail ?? this.getRecentLogTail(instance.id),
        ...(existing?.pid !== undefined ? { pid: existing.pid } : {}),
        ...(existing?.startedAt ? { startedAt: existing.startedAt } : {}),
        message: existing.status === "starting" ? "Instance startup verification is already in progress." : "Instance is already running",
      });
    }

    const bdsDirectory = `${instance.instancePath}/bds`;
    const executablePath = `${bdsDirectory}/${BDS_EXECUTABLE_NAME}`;

    await stat(executablePath);
    await chmod(executablePath, 0o755);

    await mkdir(`${instance.instancePath}/csm/logs`, { recursive: true });

    const child = spawn(`./${basename(executablePath)}`, {
      cwd: bdsDirectory,
      env: {
        ...process.env,
        LD_LIBRARY_PATH: bdsDirectory,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    const now = new Date().toISOString();
    const pid = child.pid;
    this.recentLogTails.set(instance.id, []);
    this.ensureConsoleBuffer(instance.id);
    this.currentLogSizes.set(instance.id, await prepareBdsCurrentLog(instance));
    this.logWriteChains.set(instance.id, Promise.resolve());
    const runtimeState = buildRuntimeState(instance.id, {
      status: "starting",
      desiredStatus: "running",
      healthStatus: "pending",
      isProcessActive: true,
      ...(pid !== undefined ? { pid } : {}),
      startedAt: now,
      observedAt: now,
      message: "Waiting for startup verification.",
    });

    this.processes.set(instance.id, child);
    this.setRuntimeState(instance.id, runtimeState);
    if (pid !== undefined) {
      await writeRuntimeHandle(instance, {
        instanceId: instance.id,
        pid,
        startedAt: now,
        observedAt: now,
      });
    }

    const writeLog = async (chunk: Buffer | string): Promise<void> => {
      const line = typeof chunk === "string" ? chunk : chunk.toString("utf8");
      this.appendRecentLogTail(instance.id, line);
      this.appendConsoleOutput(instance.id, "stdout", line);
      await this.appendLogChunk(instance, line);
    };

    child.stdout.on("data", async (chunk) => {
      await writeLog(chunk);
    });

    child.stderr.on("data", async (chunk) => {
      const line = chunk.toString("utf8");
      this.appendConsoleOutput(instance.id, "stderr", line);
      this.appendRecentLogTail(instance.id, line);
      await this.appendLogChunk(instance, line);
    });

    child.on("exit", (code, signal) => {
      const stoppedAt = new Date().toISOString();
      const status = code === 0 ? "stopped" : "error";
      const pid = child.pid;
      this.setRuntimeState(instance.id, buildRuntimeState(instance.id, {
        status,
        desiredStatus: savedDesiredStatus(status),
        healthStatus: status === "stopped" ? "unknown" : "unhealthy",
        isProcessActive: false,
        recentLogTail: this.getRecentLogTail(instance.id),
        ...(pid !== undefined ? { pid } : {}),
        startedAt: now,
        stoppedAt,
        exitCode: code,
        signal: signal ?? null,
        message:
          status === "stopped"
            ? "Process exited cleanly."
            : "Process exited with error before or during startup verification.",
      }));
      this.processes.delete(instance.id);
      this.logWriteChains.delete(instance.id);
      this.appendConsoleSystemLine(instance.id, status === "stopped" ? "Process exited cleanly." : "Process exited with error.");
      void removeRuntimeHandle(instance).catch(() => undefined);
    });

    child.on("error", (error) => {
      const message = error instanceof Error ? error.message : String(error);
      const pid = child.pid;
      this.setRuntimeState(instance.id, buildRuntimeState(instance.id, {
        status: "error",
        desiredStatus: "running",
        healthStatus: "unhealthy",
        isProcessActive: false,
        recentLogTail: this.getRecentLogTail(instance.id),
        ...(pid !== undefined ? { pid } : {}),
        startedAt: now,
        error: message,
        message: "Failed to start Bedrock server process",
      }));
      this.processes.delete(instance.id);
      this.logWriteChains.delete(instance.id);
      this.appendConsoleSystemLine(instance.id, "Failed to start Bedrock server process.");
      void removeRuntimeHandle(instance).catch(() => undefined);
    });

    return await this.waitForStartupVerification(instance.id, child);
  }

  async stop(instanceId: string): Promise<BdsRuntimeState> {
    const child = this.processes.get(instanceId);
    const saved = this.runtimeStates.get(instanceId);
    const instance = this.instances.get(instanceId);

    if (!child && saved?.isProcessActive && saved.pid !== undefined) {
      return await this.stopRecoveredProcess(instanceId, saved.pid, saved, instance);
    }

    if (!child) {
      return buildRuntimeState(instanceId, {
        status: "stopped",
        desiredStatus: "stopped",
        healthStatus: "unknown",
        maintenanceStatus: saved?.maintenanceStatus ?? "idle",
        isProcessActive: false,
        recentLogTail: this.getRecentLogTail(instanceId),
        ...(saved?.pid !== undefined ? { pid: saved.pid } : {}),
        ...(saved?.startedAt ? { startedAt: saved.startedAt } : {}),
        stoppedAt: new Date().toISOString(),
        message: "Instance is not running",
      });
    }

    const pid = child.pid;
    const runtimeState = buildRuntimeState(instanceId, {
      status: "stopping",
      desiredStatus: "stopped",
      healthStatus: "pending",
      maintenanceStatus: saved?.maintenanceStatus ?? "idle",
      isProcessActive: true,
      recentLogTail: this.getRecentLogTail(instanceId),
      ...(pid !== undefined ? { pid } : {}),
      ...(saved?.startedAt ? { startedAt: saved.startedAt } : {}),
    });

    this.setRuntimeState(instanceId, runtimeState);

    const stopPromise = new Promise<BdsRuntimeState>((resolve) => {
      let cleanedUp = false;
      let stopTimer: NodeJS.Timeout | undefined;
      let termTimer: NodeJS.Timeout | undefined;

      const cleanup = () => {
        if (stopTimer) {
          clearTimeout(stopTimer);
        }

        if (termTimer) {
          clearTimeout(termTimer);
        }
      };

      const finish = (state: BdsRuntimeState) => {
        if (cleanedUp) return;
        cleanedUp = true;
        cleanup();
        this.processes.delete(instanceId);
        this.setRuntimeState(instanceId, state);
        if (instance) {
          void removeRuntimeHandle(instance).catch(() => undefined);
        }
        resolve(state);
      };

      const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
        const stoppedAt = new Date().toISOString();
        const status = code === 0 ? "stopped" : "error";
        const pid = child.pid;
        finish(buildRuntimeState(instanceId, {
          status,
          desiredStatus: "stopped",
          healthStatus: status === "stopped" ? "unknown" : "unhealthy",
          maintenanceStatus: saved?.maintenanceStatus ?? "idle",
          isProcessActive: false,
          recentLogTail: this.getRecentLogTail(instanceId),
          ...(pid !== undefined ? { pid } : {}),
          ...(saved?.startedAt ? { startedAt: saved.startedAt } : {}),
          stoppedAt,
          exitCode: code,
          signal: signal ?? null,
          message: status === "stopped" ? "Process stopped cleanly" : "Process stopped with error",
        }));
      };

      child.once("exit", onExit);
      child.once("error", (error) => {
        const message = error instanceof Error ? error.message : String(error);
        const pid = child.pid;
        finish(buildRuntimeState(instanceId, {
          status: "error",
          desiredStatus: "stopped",
          healthStatus: "unhealthy",
          maintenanceStatus: saved?.maintenanceStatus ?? "idle",
          isProcessActive: false,
          recentLogTail: this.getRecentLogTail(instanceId),
          ...(pid !== undefined ? { pid } : {}),
          ...(saved?.startedAt ? { startedAt: saved.startedAt } : {}),
          stoppedAt: new Date().toISOString(),
          error: message,
          message: "Bedrock process error during stop",
        }));
      });

      const sendStop = async (): Promise<void> => {
        if (child.stdin.writable) {
          child.stdin.write("stop\n");
        }
      };

      stopTimer = setTimeout(() => {
        if (!child.killed) {
          child.kill("SIGTERM");
        }
      }, STOP_TIMEOUT_MS);

      termTimer = setTimeout(() => {
        if (!child.killed) {
          child.kill("SIGKILL");
        }
      }, STOP_TIMEOUT_MS + TERM_TIMEOUT_MS);

      sendStop().catch(() => {
        child.kill("SIGTERM");
      });
    });

    return stopPromise;
  }

  async restart(instance: Instance): Promise<BdsRuntimeState> {
    await this.stop(instance.id);
    return this.start(instance);
  }

  async reconcile(instance: Instance): Promise<BdsRuntimeState> {
    this.instances.set(instance.id, instance);

    const persistedHandle = await readRuntimeHandle(instance);
    if (!persistedHandle) {
      return buildRuntimeState(instance.id, {
        status: instance.status === "stopped" ? "stopped" : "unknown",
        desiredStatus: instance.status === "stopped" ? "stopped" : "running",
        healthStatus: instance.status === "stopped" ? "unknown" : "unhealthy",
        isProcessActive: false,
        message:
          instance.status === "stopped"
            ? "No persisted runtime handle was present during reconciliation."
            : "Instance was previously marked active, but no persisted runtime handle was found during reconciliation.",
      });
    }

    const processInspection = await inspectRediscoverableProcess(
      persistedHandle.pid,
      `${instance.instancePath}/bds`,
    );

    if (!processInspection.exists) {
      await removeRuntimeHandle(instance);
      return buildRuntimeState(instance.id, {
        status: "unknown",
        desiredStatus: "running",
        healthStatus: "unhealthy",
        isProcessActive: false,
        ...(persistedHandle.startedAt ? { startedAt: persistedHandle.startedAt } : {}),
        stoppedAt: new Date().toISOString(),
        message: "Persisted runtime handle was found, but the BDS process is no longer running.",
      });
    }

    if (!processInspection.matchesExpectedInstance) {
      await removeRuntimeHandle(instance);
      return buildRuntimeState(instance.id, {
        status: "unknown",
        desiredStatus: "running",
        healthStatus: "unhealthy",
        isProcessActive: false,
        ...(persistedHandle.startedAt ? { startedAt: persistedHandle.startedAt } : {}),
        message: "A process with the persisted PID exists, but it does not match the expected BDS instance working directory.",
      });
    }

    const nextState = buildRuntimeState(instance.id, {
      status: "running",
      desiredStatus: "running",
      healthStatus: "degraded",
      isProcessActive: true,
      pid: persistedHandle.pid,
      ...(persistedHandle.startedAt ? { startedAt: persistedHandle.startedAt } : {}),
      message:
        "Rediscovered an existing BDS process after Chroma restart. Monitoring has resumed, but live command streaming requires a fresh managed restart.",
    });

    this.setRuntimeState(instance.id, nextState);
    return nextState;
  }

  getRuntimeState(instanceId: string): BdsRuntimeState {
    const state = this.runtimeStates.get(instanceId);

    if (state) {
      return buildRuntimeState(instanceId, {
        ...state,
        status: state.status,
        desiredStatus: state.desiredStatus,
        healthStatus: state.healthStatus,
        recentLogTail: state.recentLogTail ?? this.getRecentLogTail(instanceId),
      });
    }

    return buildRuntimeState(instanceId, {
      status: "stopped",
      desiredStatus: "stopped",
      healthStatus: "unknown",
    });
  }

  hasRuntimeState(instanceId: string): boolean {
    return this.runtimeStates.has(instanceId);
  }

  sendCommand(instanceId: string, command: string): boolean {
    const child = this.processes.get(instanceId);

    if (!child || !child.stdin.writable) {
      return false;
    }

    this.appendConsoleLine(instanceId, "command", command);
    child.stdin.write(`${command}\n`);
    return true;
  }

  getConsoleSnapshot(instanceId: string): BdsConsoleSnapshot {
    return {
      instanceId,
      lines: [...(this.consoleBuffers.get(instanceId) ?? [])],
      runtime: this.getRuntimeState(instanceId),
      liveOutput: this.processes.has(instanceId),
      canWrite: this.canWriteConsole(instanceId),
    };
  }

  subscribeToConsole(instanceId: string, listener: ConsoleListener): () => void {
    const listeners = this.consoleListeners.get(instanceId) ?? new Set<ConsoleListener>();
    listeners.add(listener);
    this.consoleListeners.set(instanceId, listeners);

    return () => {
      const current = this.consoleListeners.get(instanceId);
      if (!current) {
        return;
      }

      current.delete(listener);
      if (current.size === 0) {
        this.consoleListeners.delete(instanceId);
      }
    };
  }

  subscribeToRuntimeState(listener: RuntimeStateListener): () => void {
    this.runtimeStateListeners.add(listener);

    return () => {
      this.runtimeStateListeners.delete(listener);
    };
  }

  async stopAll(): Promise<void> {
    const stopTargets = new Set<string>([
      ...this.processes.keys(),
      ...Array.from(this.runtimeStates.entries())
        .filter(([, state]) => state.isProcessActive)
        .map(([instanceId]) => instanceId),
    ]);
    const stopPromises = Array.from(stopTargets).map((instanceId) => this.stop(instanceId));
    await Promise.all(stopPromises);
  }

  setMaintenanceState(
    instanceId: string,
    maintenanceStatus: BdsRuntimeState["maintenanceStatus"],
    message?: string,
  ): BdsRuntimeState {
    const current = this.getRuntimeState(instanceId);
    const nextState = buildRuntimeState(instanceId, {
      status: current.status,
      desiredStatus: current.desiredStatus,
      healthStatus: current.healthStatus,
      maintenanceStatus,
      isProcessActive: current.isProcessActive,
      recentLogTail: current.recentLogTail,
      ...(current.pid !== undefined ? { pid: current.pid } : {}),
      ...(current.startedAt ? { startedAt: current.startedAt } : {}),
      ...(current.stoppedAt ? { stoppedAt: current.stoppedAt } : {}),
      ...(current.exitCode !== undefined ? { exitCode: current.exitCode } : {}),
      ...(current.signal !== undefined ? { signal: current.signal } : {}),
      ...(current.error !== undefined ? { error: current.error } : {}),
      ...(message ? { message } : current.message ? { message: current.message } : {}),
    });

    this.setRuntimeState(instanceId, nextState);
    return nextState;
  }

  private async stopRecoveredProcess(
    instanceId: string,
    pid: number,
    saved: BdsRuntimeState,
    instance?: Instance,
  ): Promise<BdsRuntimeState> {
    const stoppingState = buildRuntimeState(instanceId, {
      status: "stopping",
      desiredStatus: "stopped",
      healthStatus: "pending",
      maintenanceStatus: saved.maintenanceStatus,
      isProcessActive: true,
      recentLogTail: this.getRecentLogTail(instanceId),
      pid,
      ...(saved.startedAt ? { startedAt: saved.startedAt } : {}),
      message: "Stopping rediscovered process without a live stdin channel.",
    });

    this.setRuntimeState(instanceId, stoppingState);

    try {
      process.kill(pid, "SIGTERM");
    } catch {
      if (instance) {
        await removeRuntimeHandle(instance).catch(() => undefined);
      }

      const state = buildRuntimeState(instanceId, {
        status: "unknown",
        desiredStatus: "stopped",
        healthStatus: "unhealthy",
        isProcessActive: false,
        recentLogTail: this.getRecentLogTail(instanceId),
        pid,
        ...(saved.startedAt ? { startedAt: saved.startedAt } : {}),
        stoppedAt: new Date().toISOString(),
        message: "Rediscovered process could not be signaled during stop.",
      });
      this.setRuntimeState(instanceId, state);
      return state;
    }

    const start = Date.now();
    while (Date.now() - start < STOP_TIMEOUT_MS) {
      const inspection = await inspectRediscoverableProcess(pid, `${instance?.instancePath ?? ""}/bds`);
      if (!inspection.exists) {
        if (instance) {
          await removeRuntimeHandle(instance).catch(() => undefined);
        }

        const state = buildRuntimeState(instanceId, {
          status: "stopped",
          desiredStatus: "stopped",
          healthStatus: "unknown",
          isProcessActive: false,
          recentLogTail: this.getRecentLogTail(instanceId),
          pid,
          ...(saved.startedAt ? { startedAt: saved.startedAt } : {}),
          stoppedAt: new Date().toISOString(),
          message: "Rediscovered process stopped after reconciliation.",
        });
        this.setRuntimeState(instanceId, state);
        return state;
      }

      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // ignore follow-up signal failure
    }

    if (instance) {
      await removeRuntimeHandle(instance).catch(() => undefined);
    }

    const state = buildRuntimeState(instanceId, {
      status: "error",
      desiredStatus: "stopped",
      healthStatus: "unhealthy",
      isProcessActive: false,
      recentLogTail: this.getRecentLogTail(instanceId),
      pid,
      ...(saved.startedAt ? { startedAt: saved.startedAt } : {}),
      stoppedAt: new Date().toISOString(),
      message: "Rediscovered process required forced termination during stop.",
    });
    this.setRuntimeState(instanceId, state);
    return state;
  }

  private appendRecentLogTail(instanceId: string, chunk: string): void {
    const normalized = chunk.replace(/\r/g, "");
    const lines = normalized
      .split("\n")
      .map((line) => line.trimEnd())
      .filter((line) => line !== "");

    if (lines.length === 0) {
      return;
    }

    const existing = this.recentLogTails.get(instanceId) ?? [];
    const next = [...existing, ...lines].slice(-RECENT_LOG_TAIL_LIMIT);
    this.recentLogTails.set(instanceId, next);
  }

  private getRecentLogTail(instanceId: string): string[] | undefined {
    const tail = this.recentLogTails.get(instanceId);
    return tail && tail.length > 0 ? [...tail] : undefined;
  }

  private async waitForStartupVerification(
    instanceId: string,
    child: ChildProcessWithoutNullStreams,
  ): Promise<BdsRuntimeState> {
    return await new Promise<BdsRuntimeState>((resolve) => {
      let settled = false;

      const finish = (state: BdsRuntimeState) => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timer);
        child.off("exit", handleProcessEnd);
        child.off("error", handleProcessEnd);
        resolve(state);
      };

      const handleProcessEnd = () => {
        const state = this.runtimeStates.get(instanceId) ?? buildRuntimeState(instanceId, {
          status: "error",
          desiredStatus: "running",
          healthStatus: "unhealthy",
          recentLogTail: this.getRecentLogTail(instanceId),
          message: "Process ended before startup verification completed.",
        });
        finish(state);
      };

      const timer = setTimeout(() => {
        const current = this.runtimeStates.get(instanceId);
        const recentLogTail = this.getRecentLogTail(instanceId);

        if (!current || !this.processes.has(instanceId)) {
          finish(
            current ??
              buildRuntimeState(instanceId, {
                status: "error",
                desiredStatus: "running",
                healthStatus: "unhealthy",
                recentLogTail,
                message: "Startup verification failed because the process was no longer active.",
              }),
          );
          return;
        }

        const nextState = buildRuntimeState(instanceId, {
          status: "running",
          desiredStatus: "running",
          healthStatus: recentLogTail && recentLogTail.length > 0 ? "healthy" : "degraded",
          maintenanceStatus: current.maintenanceStatus,
          isProcessActive: true,
          recentLogTail,
          ...(current.pid !== undefined ? { pid: current.pid } : {}),
          ...(current.startedAt ? { startedAt: current.startedAt } : {}),
          message:
            recentLogTail && recentLogTail.length > 0
              ? "Startup verified after the process survived the verification window and produced runtime output."
              : "Process survived the startup verification window but did not produce recent runtime output.",
        });

        this.setRuntimeState(instanceId, nextState);
        finish(nextState);
      }, START_VERIFICATION_WINDOW_MS);

      child.once("exit", handleProcessEnd);
      child.once("error", handleProcessEnd);
    });
  }

  private canWriteConsole(instanceId: string): boolean {
    const child = this.processes.get(instanceId);
    return Boolean(child && child.stdin.writable);
  }

  private ensureConsoleBuffer(instanceId: string): BdsConsoleLine[] {
    const existing = this.consoleBuffers.get(instanceId);
    if (existing) {
      return existing;
    }

    const next: BdsConsoleLine[] = [];
    this.consoleBuffers.set(instanceId, next);
    return next;
  }

  private appendConsoleOutput(instanceId: string, source: "stdout" | "stderr", chunk: string): void {
    const normalized = chunk.replace(/\r/g, "");
    const lines = normalized
      .split("\n")
      .map((line) => line.trimEnd())
      .filter((line) => line !== "");

    for (const line of lines) {
      this.appendConsoleLine(instanceId, source, line);
    }
  }

  private appendConsoleSystemLine(instanceId: string, text: string): void {
    this.appendConsoleLine(instanceId, "system", text);
  }

  private appendConsoleLine(instanceId: string, source: BdsConsoleLine["source"], text: string): void {
    const line: BdsConsoleLine = {
      id: createId("console"),
      instanceId,
      source,
      text,
      createdAt: new Date().toISOString(),
    };

    const buffer = this.ensureConsoleBuffer(instanceId);
    buffer.push(line);

    if (buffer.length > CONSOLE_SCROLLBACK_LIMIT) {
      buffer.splice(0, buffer.length - CONSOLE_SCROLLBACK_LIMIT);
    }

    this.notifyConsoleListeners(instanceId, {
      type: "line",
      line,
    });
  }

  private emitConsoleStatus(instanceId: string): void {
    this.notifyConsoleListeners(instanceId, {
      type: "status",
      snapshot: this.getConsoleSnapshot(instanceId),
    });
  }

  private setRuntimeState(instanceId: string, nextState: BdsRuntimeState): void {
    const previousState = this.runtimeStates.get(instanceId);
    this.runtimeStates.set(instanceId, nextState);
    this.emitConsoleStatus(instanceId);

    for (const listener of this.runtimeStateListeners) {
      try {
        listener(nextState, previousState);
      } catch {
        // Ignore listener errors so runtime state propagation never interrupts process management.
      }
    }
  }

  private notifyConsoleListeners(
    instanceId: string,
    event: { type: "line"; line: BdsConsoleLine } | { type: "status"; snapshot: BdsConsoleSnapshot },
  ): void {
    const listeners = this.consoleListeners.get(instanceId);
    if (!listeners || listeners.size === 0) {
      return;
    }

    for (const listener of listeners) {
      listener(event);
    }
  }

  private async appendLogChunk(instance: Instance, chunk: string): Promise<void> {
    const previousWrite = this.logWriteChains.get(instance.id) ?? Promise.resolve();
    const nextWrite = previousWrite
      .catch(() => undefined)
      .then(async () => {
        const currentSize = this.currentLogSizes.get(instance.id) ?? 0;
        const nextSize = await appendBdsLogChunk(instance, chunk, currentSize);
        this.currentLogSizes.set(instance.id, nextSize);
      });

    this.logWriteChains.set(instance.id, nextWrite);
    await nextWrite;
  }
}

function savedDesiredStatus(status: BdsRuntimeState["status"]): BdsRuntimeState["desiredStatus"] {
  return status === "stopped" ? "stopped" : "running";
}
