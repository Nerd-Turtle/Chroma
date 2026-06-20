import { access, readFile } from "node:fs/promises";
import { createSocket } from "node:dgram";
import { join } from "node:path";
import type { Database } from "better-sqlite3";
import type { BedrockServerSettings, Instance } from "../../shared/types/index.js";
import { listInstances } from "../instances/instanceService.js";
import { getSettings } from "../instances/instanceSettingsService.js";
import { getBdsInstall } from "./bdsRepository.js";

export type BdsStartValidationIssueLevel = "error" | "warning";

export type BdsStartValidationIssue = {
  code: string;
  level: BdsStartValidationIssueLevel;
  message: string;
  field?: string;
};

export type BdsStartValidationResult = {
  canStart: boolean;
  errors: BdsStartValidationIssue[];
  warnings: BdsStartValidationIssue[];
};

type StartValidationContext = {
  db: Database;
  instance: Instance;
  settings: BedrockServerSettings | undefined;
};

type StartValidator = (context: StartValidationContext) => Promise<BdsStartValidationIssue[]>;

const validators: StartValidator[] = [
  validateBdsInstallPresence,
  validateSettingsPresence,
  validateExecutableReadable,
  validateServerPropertiesReadable,
  validateConfiguredPorts,
  validatePortConflictsWithOtherInstances,
  validateHostPortAvailability,
];

export class BdsStartValidationError extends Error {
  readonly result: BdsStartValidationResult;

  constructor(result: BdsStartValidationResult) {
    const message =
      result.errors.length > 0
        ? result.errors.map((issue) => issue.message).join(" ")
        : "Pre-start validation blocked the server from starting.";
    super(message);
    this.name = "BdsStartValidationError";
    this.result = result;
  }
}

function splitIssues(issues: BdsStartValidationIssue[]): BdsStartValidationResult {
  const errors = issues.filter((issue) => issue.level === "error");
  const warnings = issues.filter((issue) => issue.level === "warning");

  return {
    canStart: errors.length === 0,
    errors,
    warnings,
  };
}

async function validateSettingsPresence(context: StartValidationContext): Promise<BdsStartValidationIssue[]> {
  if (context.settings) {
    return [];
  }

  return [
    {
      code: "settings_missing",
      level: "error",
      field: "settings",
      message: "Instance settings are missing. Recreate or repair server settings before starting the instance.",
    },
  ];
}

async function validateBdsInstallPresence(context: StartValidationContext): Promise<BdsStartValidationIssue[]> {
  const install = getBdsInstall(context.db, context.instance.id);

  if (install?.status === "installed") {
    return [];
  }

  return [
    {
      code: "bds_not_installed",
      level: "error",
      field: "bds",
      message: "BDS is not installed for this instance.",
    },
  ];
}

async function validateExecutableReadable(context: StartValidationContext): Promise<BdsStartValidationIssue[]> {
  const executablePath = join(context.instance.instancePath, "bds", "bedrock_server");

  try {
    await access(executablePath);
    return [];
  } catch {
    return [
      {
        code: "bds_executable_missing",
        level: "error",
        field: "bds",
        message: "The Bedrock server executable is missing or unreadable for this instance.",
      },
    ];
  }
}

async function validateServerPropertiesReadable(context: StartValidationContext): Promise<BdsStartValidationIssue[]> {
  const serverPropertiesPath = join(context.instance.instancePath, "bds", "server.properties");

  try {
    await access(serverPropertiesPath);
    await readFile(serverPropertiesPath, "utf8");
    return [];
  } catch {
    return [
      {
        code: "server_properties_unavailable",
        level: "error",
        field: "server.properties",
        message: "server.properties is missing or unreadable for this instance.",
      },
    ];
  }
}

async function validateConfiguredPorts(context: StartValidationContext): Promise<BdsStartValidationIssue[]> {
  if (!context.settings) {
    return [];
  }

  const issues: BdsStartValidationIssue[] = [];
  const checks: Array<{ field: "serverPort" | "serverPortV6"; value: number; label: string }> = [
    { field: "serverPort", value: context.settings.serverPort, label: "IPv4 server port" },
    { field: "serverPortV6", value: context.settings.serverPortV6, label: "IPv6 server port" },
  ];

  for (const check of checks) {
    if (!Number.isInteger(check.value) || check.value < 1 || check.value > 65535) {
      issues.push({
        code: "invalid_port",
        level: "error",
        field: check.field,
        message: `${check.label} must be an integer between 1 and 65535.`,
      });
    }
  }

  return issues;
}

async function validatePortConflictsWithOtherInstances(context: StartValidationContext): Promise<BdsStartValidationIssue[]> {
  if (!context.settings) {
    return [];
  }

  const issues: BdsStartValidationIssue[] = [];

  for (const otherInstance of listInstances(context.db)) {
    if (otherInstance.id === context.instance.id) {
      continue;
    }

    const otherSettings = getSettings(context.db, otherInstance.id);
    if (!otherSettings) {
      continue;
    }

    if (otherSettings.serverPort === context.settings.serverPort) {
      issues.push({
        code: "shared_ipv4_port",
        level:
          otherInstance.status === "running" || otherInstance.status === "starting" || otherInstance.status === "unknown"
            ? "error"
            : "warning",
        field: "serverPort",
        message:
          otherInstance.status === "running" || otherInstance.status === "starting" || otherInstance.status === "unknown"
            ? `Configured IPv4 port ${context.settings.serverPort} is already in use by instance "${otherInstance.friendlyName}".`
            : `Configured IPv4 port ${context.settings.serverPort} is also assigned to instance "${otherInstance.friendlyName}".`,
      });
    }

    if (otherSettings.serverPortV6 === context.settings.serverPortV6) {
      issues.push({
        code: "shared_ipv6_port",
        level:
          otherInstance.status === "running" || otherInstance.status === "starting" || otherInstance.status === "unknown"
            ? "error"
            : "warning",
        field: "serverPortV6",
        message:
          otherInstance.status === "running" || otherInstance.status === "starting" || otherInstance.status === "unknown"
            ? `Configured IPv6 port ${context.settings.serverPortV6} is already in use by instance "${otherInstance.friendlyName}".`
            : `Configured IPv6 port ${context.settings.serverPortV6} is also assigned to instance "${otherInstance.friendlyName}".`,
      });
    }
  }

  return issues;
}

function probeUdpPort(type: "udp4" | "udp6", port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createSocket(type);
    let settled = false;

    const finish = (available: boolean) => {
      if (settled) {
        return;
      }

      settled = true;
      socket.close(() => resolve(available));
    };

    socket.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EADDRINUSE") {
        finish(false);
        return;
      }

      finish(true);
    });

    socket.once("listening", () => finish(true));
    socket.bind(port, type === "udp4" ? "0.0.0.0" : "::");
  });
}

async function validateHostPortAvailability(context: StartValidationContext): Promise<BdsStartValidationIssue[]> {
  if (!context.settings) {
    return [];
  }

  const issues: BdsStartValidationIssue[] = [];
  const [ipv4Available, ipv6Available] = await Promise.all([
    probeUdpPort("udp4", context.settings.serverPort),
    probeUdpPort("udp6", context.settings.serverPortV6),
  ]);

  if (!ipv4Available) {
    issues.push({
      code: "host_ipv4_port_unavailable",
      level: "error",
      field: "serverPort",
      message: `Host UDP port ${context.settings.serverPort} is already bound by another process.`,
    });
  }

  if (!ipv6Available) {
    issues.push({
      code: "host_ipv6_port_unavailable",
      level: "error",
      field: "serverPortV6",
      message: `Host UDP port ${context.settings.serverPortV6} for IPv6 is already bound by another process.`,
    });
  }

  return issues;
}

export async function validateInstanceCanStart(db: Database, instance: Instance): Promise<BdsStartValidationResult> {
  const settings = getSettings(db, instance.id);
  const context: StartValidationContext = {
    db,
    instance,
    settings,
  };

  const issues = (await Promise.all(validators.map((validator) => validator(context)))).flat();
  return splitIssues(issues);
}

export async function assertInstanceCanStart(db: Database, instance: Instance): Promise<void> {
  const result = await validateInstanceCanStart(db, instance);

  if (!result.canStart) {
    throw new BdsStartValidationError(result);
  }
}
