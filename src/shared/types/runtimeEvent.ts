export type InstanceRuntimeEventLevel = "info" | "warning" | "error";

export type InstanceRuntimeEventCategory = "runtime" | "backup" | "update" | "settings";

export type InstanceRuntimeEvent = {
  id: string;
  instanceId: string;
  category: InstanceRuntimeEventCategory;
  action: string;
  level: InstanceRuntimeEventLevel;
  message: string;
  details?: Record<string, unknown>;
  createdAt: string;
};
