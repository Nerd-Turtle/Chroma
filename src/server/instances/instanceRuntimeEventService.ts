import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Database } from "better-sqlite3";
import type {
  Instance,
  InstanceRuntimeEvent,
  InstanceRuntimeEventCategory,
  InstanceRuntimeEventLevel,
} from "../../shared/types/index.js";
import { createId } from "../utils/createId.js";
import { getInstance } from "./instanceService.js";

type RuntimeEventRow = {
  id: string;
  instance_id: string;
  category: string;
  action: string;
  level: string;
  message: string;
  details_json: string | null;
  created_at: string;
};

export type AppendInstanceRuntimeEventInput = {
  category: InstanceRuntimeEventCategory;
  action: string;
  level: InstanceRuntimeEventLevel;
  message: string;
  details?: Record<string, unknown>;
  createdAt?: string;
};

function getRuntimeEventsDirectory(instance: Instance): string {
  return join(instance.instancePath, "csm", "events");
}

function getRuntimeEventsFilePath(instance: Instance): string {
  return join(getRuntimeEventsDirectory(instance), "runtime-events.jsonl");
}

function mapRuntimeEventRow(row: RuntimeEventRow): InstanceRuntimeEvent {
  const event: InstanceRuntimeEvent = {
    id: row.id,
    instanceId: row.instance_id,
    category: row.category as InstanceRuntimeEventCategory,
    action: row.action,
    level: row.level as InstanceRuntimeEventLevel,
    message: row.message,
    createdAt: row.created_at,
  };

  if (row.details_json) {
    event.details = JSON.parse(row.details_json) as Record<string, unknown>;
  }

  return event;
}

export async function appendInstanceRuntimeEvent(
  db: Database,
  instanceId: string,
  input: AppendInstanceRuntimeEventInput,
): Promise<InstanceRuntimeEvent> {
  const instance = getInstance(db, instanceId);
  if (!instance) {
    throw new Error("Instance not found");
  }

  const createdAt = input.createdAt ?? new Date().toISOString();
  const event: InstanceRuntimeEvent = {
    id: createId("evt"),
    instanceId,
    category: input.category,
    action: input.action,
    level: input.level,
    message: input.message,
    createdAt,
  };

  if (input.details) {
    event.details = input.details;
  }

  const detailsJson = event.details ? JSON.stringify(event.details) : null;

  db.prepare(
    `INSERT INTO instance_runtime_events (
      id,
      instance_id,
      category,
      action,
      level,
      message,
      details_json,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    event.id,
    event.instanceId,
    event.category,
    event.action,
    event.level,
    event.message,
    detailsJson,
    event.createdAt,
  );

  const eventsDirectory = getRuntimeEventsDirectory(instance);
  await mkdir(eventsDirectory, { recursive: true });
  await appendFile(getRuntimeEventsFilePath(instance), `${JSON.stringify(event)}\n`, "utf8");

  return event;
}

export function listRecentInstanceRuntimeEvents(
  db: Database,
  instanceId: string,
  limit = 15,
): InstanceRuntimeEvent[] {
  const rows = db.prepare(
    `SELECT *
      FROM instance_runtime_events
      WHERE instance_id = ?
      ORDER BY created_at DESC
      LIMIT ?`
  ).all(instanceId, limit) as RuntimeEventRow[];

  return rows.map(mapRuntimeEventRow);
}
