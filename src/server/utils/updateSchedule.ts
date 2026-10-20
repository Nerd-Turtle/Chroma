import type { InstanceUpdateCheckWeekday } from "../../shared/types/index.js";

type Schedule = { updateCheckFrequency: "daily" | "weekly"; updateCheckWeekday: InstanceUpdateCheckWeekday; updateCheckTime: string };

export function isUpdateScheduleDue(schedule: Schedule, lastCheckedAt: string | undefined | null, timeZone: string, now = new Date()): boolean {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(schedule.updateCheckTime)) return false;
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", weekday: "long", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const parts = (date: Date) => Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  const current = parts(now);
  if (`${current.hour}:${current.minute}` < schedule.updateCheckTime) return false;
  if (schedule.updateCheckFrequency === "weekly" && current.weekday?.toLowerCase() !== schedule.updateCheckWeekday) return false;
  if (!lastCheckedAt || !Number.isFinite(Date.parse(lastCheckedAt))) return true;
  const previous = parts(new Date(lastCheckedAt));
  return `${current.year}-${current.month}-${current.day}` > `${previous.year}-${previous.month}-${previous.day}`;
}
