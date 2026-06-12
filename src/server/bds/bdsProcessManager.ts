import { chmod, mkdir, stat, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import { spawn, ChildProcessWithoutNullStreams } from "node:child_process";
import type { Instance } from "../../shared/types/index.js";
import type { BdsRuntimeState } from "../../shared/types/bdsRuntime.js";

const BDS_EXECUTABLE_NAME = "bedrock_server";
const BDS_LOG_FILENAME = "bds-current.log";
const STOP_TIMEOUT_MS = 30000;
const TERM_TIMEOUT_MS = 10000;

export class BdsProcessManager {
  private processes = new Map<string, ChildProcessWithoutNullStreams>();
  private runtimeStates = new Map<string, BdsRuntimeState>();

  async start(instance: Instance): Promise<BdsRuntimeState> {
    const existing = this.runtimeStates.get(instance.id);

    if (existing?.status === "running" || this.processes.has(instance.id)) {
      return {
        instanceId: instance.id,
        status: "running",
        ...(existing?.pid !== undefined ? { pid: existing.pid } : {}),
        ...(existing?.startedAt ? { startedAt: existing.startedAt } : {}),
        message: "Instance is already running",
      };
    }

    const bdsDirectory = `${instance.instancePath}/bds`;
    const executablePath = `${bdsDirectory}/${BDS_EXECUTABLE_NAME}`;

    await stat(executablePath);
    await chmod(executablePath, 0o755);

    const logPath = `${instance.instancePath}/csm/logs/${BDS_LOG_FILENAME}`;
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
    const runtimeState: BdsRuntimeState = {
      instanceId: instance.id,
      status: "running",
      ...(pid !== undefined ? { pid } : {}),
      startedAt: now,
    };

    this.processes.set(instance.id, child);
    this.runtimeStates.set(instance.id, runtimeState);

    const writeLog = async (chunk: Buffer | string): Promise<void> => {
      const line = typeof chunk === "string" ? chunk : chunk.toString("utf8");
      await writeFile(logPath, line, { flag: "a" });
    };

    child.stdout.on("data", async (chunk) => {
      await writeLog(chunk);
    });

    child.stderr.on("data", async (chunk) => {
      await writeLog(chunk);
    });

    child.on("exit", (code, signal) => {
      const stoppedAt = new Date().toISOString();
      const status = code === 0 ? "stopped" : "error";
      const pid = child.pid;
      this.runtimeStates.set(instance.id, {
        instanceId: instance.id,
        status,
        ...(pid !== undefined ? { pid } : {}),
        startedAt: now,
        stoppedAt,
        exitCode: code,
        signal: signal ?? null,
        message: status === "stopped" ? "Process exited cleanly" : "Process exited with error",
      });
      this.processes.delete(instance.id);
    });

    child.on("error", (error) => {
      const message = error instanceof Error ? error.message : String(error);
      const pid = child.pid;
      this.runtimeStates.set(instance.id, {
        instanceId: instance.id,
        status: "error",
        ...(pid !== undefined ? { pid } : {}),
        startedAt: now,
        error: message,
        message: "Failed to start Bedrock server process",
      });
      this.processes.delete(instance.id);
    });

    return runtimeState;
  }

  async stop(instanceId: string): Promise<BdsRuntimeState> {
    const child = this.processes.get(instanceId);
    const saved = this.runtimeStates.get(instanceId);

    if (!child) {
      return {
        instanceId,
        status: "stopped",
        ...(saved?.pid !== undefined ? { pid: saved.pid } : {}),
        ...(saved?.startedAt ? { startedAt: saved.startedAt } : {}),
        stoppedAt: new Date().toISOString(),
        message: "Instance is not running",
      };
    }

    const pid = child.pid;
    const runtimeState: BdsRuntimeState = {
      instanceId,
      status: "stopping",
      ...(pid !== undefined ? { pid } : {}),
      ...(saved?.startedAt ? { startedAt: saved.startedAt } : {}),
    };

    this.runtimeStates.set(instanceId, runtimeState);

    const stopPromise = new Promise<BdsRuntimeState>((resolve) => {
      let cleanedUp = false;

      const finish = (state: BdsRuntimeState) => {
        if (cleanedUp) return;
        cleanedUp = true;
        this.processes.delete(instanceId);
        this.runtimeStates.set(instanceId, state);
        resolve(state);
      };

      const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
        const stoppedAt = new Date().toISOString();
        const status = code === 0 ? "stopped" : "error";
        const pid = child.pid;
        finish({
          instanceId,
          status,
          ...(pid !== undefined ? { pid } : {}),
          ...(saved?.startedAt ? { startedAt: saved.startedAt } : {}),
          stoppedAt,
          exitCode: code,
          signal: signal ?? null,
          message: status === "stopped" ? "Process stopped cleanly" : "Process stopped with error",
        });
      };

      child.once("exit", onExit);
      child.once("error", (error) => {
        const message = error instanceof Error ? error.message : String(error);
        const pid = child.pid;
        finish({
          instanceId,
          status: "error",
          ...(pid !== undefined ? { pid } : {}),
          ...(saved?.startedAt ? { startedAt: saved.startedAt } : {}),
          stoppedAt: new Date().toISOString(),
          error: message,
          message: "Bedrock process error during stop",
        });
      });

      const sendStop = async (): Promise<void> => {
        if (child.stdin.writable) {
          child.stdin.write("stop\n");
        }
      };

      const stopTimer = setTimeout(() => {
        if (!child.killed) {
          child.kill("SIGTERM");
        }
      }, STOP_TIMEOUT_MS);

      const termTimer = setTimeout(() => {
        if (!child.killed) {
          child.kill("SIGKILL");
        }
      }, STOP_TIMEOUT_MS + TERM_TIMEOUT_MS);

      sendStop().catch(() => {
        child.kill("SIGTERM");
      });

      const cleanup = () => {
        clearTimeout(stopTimer);
        clearTimeout(termTimer);
      };

      stopPromise.finally(cleanup);
    });

    return stopPromise;
  }

  async restart(instance: Instance): Promise<BdsRuntimeState> {
    await this.stop(instance.id);
    return this.start(instance);
  }

  getRuntimeState(instanceId: string): BdsRuntimeState {
    const state = this.runtimeStates.get(instanceId);

    if (state) {
      return state;
    }

    return {
      instanceId,
      status: "stopped",
    };
  }

  async stopAll(): Promise<void> {
    const stopPromises = Array.from(this.processes.keys()).map((instanceId) => this.stop(instanceId));
    await Promise.all(stopPromises);
  }
}
