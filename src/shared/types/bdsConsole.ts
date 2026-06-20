import type { BdsRuntimeState } from "./bdsRuntime.js";

export type BdsConsoleSource = "stdout" | "stderr" | "command" | "system";

export type BdsConsoleLine = {
  id: string;
  instanceId: string;
  source: BdsConsoleSource;
  text: string;
  createdAt: string;
};

export type BdsConsoleSnapshot = {
  instanceId: string;
  lines: BdsConsoleLine[];
  runtime: BdsRuntimeState;
  liveOutput: boolean;
  canWrite: boolean;
};
