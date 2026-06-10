export type JobStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed";

export type Job = {
  id: string;
  instanceId?: string;
  type: string;
  status: JobStatus;
  message?: string;
  error?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
};
