import { TelegramPublishQueueRepository, type TelegramRouteOutputRecord } from "@curator/db";

export type TelegramPublishScheduleDecision = {
  publishMode: TelegramRouteOutputRecord["publishMode"];
  scheduledFor?: string;
  priority: number;
  reason: "immediate" | "queued_without_schedule" | "scheduled" | "publish_disabled";
};

export async function decideTelegramPublishSchedule(input: {
  routeOutput: TelegramRouteOutputRecord;
  queueRepository: TelegramPublishQueueRepository;
  now?: Date;
}): Promise<TelegramPublishScheduleDecision> {
  const now = input.now ?? new Date();
  if (!input.routeOutput.publishEnabled) {
    return {
      publishMode: input.routeOutput.publishMode,
      priority: input.routeOutput.queuePriority,
      reason: "publish_disabled"
    };
  }

  if (input.routeOutput.publishMode === "immediate") {
    return {
      publishMode: "immediate",
      priority: input.routeOutput.queuePriority,
      reason: "immediate"
    };
  }

  if (input.routeOutput.publishMode === "queued") {
    return {
      publishMode: "queued",
      priority: input.routeOutput.queuePriority,
      reason: "queued_without_schedule"
    };
  }

  const scheduledFor = await computeScheduledFor(input.routeOutput, input.queueRepository, now);
  return {
    publishMode: "scheduled",
    scheduledFor,
    priority: input.routeOutput.queuePriority,
    reason: "scheduled"
  };
}

async function computeScheduledFor(routeOutput: TelegramRouteOutputRecord, queueRepository: TelegramPublishQueueRepository, now: Date): Promise<string> {
  const lastForTarget = await queueRepository.findLatestForFinalTarget(routeOutput.finalChatId, routeOutput.finalThreadId);
  let candidate = new Date(now.getTime());

  if (lastForTarget) {
    const lastTime = new Date(lastForTarget.scheduledFor ?? lastForTarget.updatedAt ?? lastForTarget.createdAt).getTime();
    const minGapTime = lastTime + routeOutput.minimumGapMinutes * 60_000;
    if (Number.isFinite(minGapTime) && minGapTime > candidate.getTime()) {
      candidate = new Date(minGapTime);
    }
  }

  for (let guard = 0; guard < 40; guard += 1) {
    candidate = fitAllowedWindow(candidate, routeOutput.timezone, routeOutput.allowedPublishWindows);

    const hourWindow = localHourUtcRange(candidate, routeOutput.timezone);
    const dayWindow = localDayUtcRange(candidate, routeOutput.timezone);
    const hourCount = await queueRepository.countForFinalTargetBetween(routeOutput.finalChatId, hourWindow.start.toISOString(), hourWindow.end.toISOString(), routeOutput.finalThreadId);
    if (routeOutput.maxPostsPerHour > 0 && hourCount >= routeOutput.maxPostsPerHour) {
      candidate = new Date(hourWindow.end.getTime());
      continue;
    }

    const dayCount = await queueRepository.countForFinalTargetBetween(routeOutput.finalChatId, dayWindow.start.toISOString(), dayWindow.end.toISOString(), routeOutput.finalThreadId);
    if (routeOutput.maxPostsPerDay > 0 && dayCount >= routeOutput.maxPostsPerDay) {
      candidate = new Date(dayWindow.end.getTime());
      continue;
    }

    return candidate.toISOString();
  }

  return candidate.toISOString();
}

function fitAllowedWindow(candidate: Date, timezone: string, windows: string[]): Date {
  const parsedWindows = windows.map(parseWindow).filter((window): window is PublishWindow => window !== undefined);
  if (parsedWindows.length === 0) return candidate;

  let current = new Date(candidate.getTime());
  for (let index = 0; index < 8 * 24 * 60; index += 1) {
    const minute = localMinuteOfDay(current, timezone);
    if (parsedWindows.some((window) => containsMinute(window, minute))) {
      return current;
    }
    current = new Date(current.getTime() + 60_000);
  }
  return candidate;
}

type PublishWindow = { start: number; end: number };

function parseWindow(value: string): PublishWindow | undefined {
  const match = value.trim().match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/);
  if (!match) return undefined;
  const startHour = Number.parseInt(match[1] ?? "", 10);
  const startMinute = Number.parseInt(match[2] ?? "", 10);
  const endHour = Number.parseInt(match[3] ?? "", 10);
  const endMinute = Number.parseInt(match[4] ?? "", 10);
  if (![startHour, startMinute, endHour, endMinute].every(Number.isFinite)) return undefined;
  if (startHour > 23 || endHour > 23 || startMinute > 59 || endMinute > 59) return undefined;
  return { start: startHour * 60 + startMinute, end: endHour * 60 + endMinute };
}

function containsMinute(window: PublishWindow, minute: number): boolean {
  if (window.start <= window.end) return minute >= window.start && minute <= window.end;
  return minute >= window.start || minute <= window.end;
}

function localMinuteOfDay(date: Date, timezone: string): number {
  const safeTimezone = timezone.trim().length > 0 ? timezone : "UTC";
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: safeTimezone,
      hour12: false,
      hour: "2-digit",
      minute: "2-digit"
    }).formatToParts(date);
  } catch {
    parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "UTC",
      hour12: false,
      hour: "2-digit",
      minute: "2-digit"
    }).formatToParts(date);
  }
  const hour = Number.parseInt(parts.find((part) => part.type === "hour")?.value ?? "0", 10);
  const minute = Number.parseInt(parts.find((part) => part.type === "minute")?.value ?? "0", 10);
  return (hour % 24) * 60 + minute;
}

function localHourUtcRange(date: Date, timezone: string): { start: Date; end: Date } {
  const parts = localDateTimeParts(date, timezone);
  const start = localDateTimeToUtc(parts.year, parts.month, parts.day, parts.hour, 0, timezone);
  const nextLocal = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour + 1, 0, 0, 0));
  const end = localDateTimeToUtc(nextLocal.getUTCFullYear(), nextLocal.getUTCMonth() + 1, nextLocal.getUTCDate(), nextLocal.getUTCHours(), 0, timezone);
  return { start, end };
}

function localDayUtcRange(date: Date, timezone: string): { start: Date; end: Date } {
  const parts = localDateTimeParts(date, timezone);
  const start = localDateTimeToUtc(parts.year, parts.month, parts.day, 0, 0, timezone);
  const nextLocal = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + 1, 0, 0, 0, 0));
  const end = localDateTimeToUtc(nextLocal.getUTCFullYear(), nextLocal.getUTCMonth() + 1, nextLocal.getUTCDate(), 0, 0, timezone);
  return { start, end };
}

function localDateTimeParts(date: Date, timezone: string): { year: number; month: number; day: number; hour: number; minute: number } {
  const parts = safeFormatParts(date, timezone, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
  return {
    year: readPart(parts, "year"),
    month: readPart(parts, "month"),
    day: readPart(parts, "day"),
    hour: readPart(parts, "hour") % 24,
    minute: readPart(parts, "minute")
  };
}

function localDateTimeToUtc(year: number, month: number, day: number, hour: number, minute: number, timezone: string): Date {
  let utc = new Date(Date.UTC(year, month - 1, day, hour, minute, 0, 0));
  for (let index = 0; index < 3; index += 1) {
    const parts = localDateTimeParts(utc, timezone);
    const localAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0, 0);
    const desiredAsUtc = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
    const delta = localAsUtc - desiredAsUtc;
    if (delta === 0) return utc;
    utc = new Date(utc.getTime() - delta);
  }
  return utc;
}

function safeFormatParts(date: Date, timezone: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormatPart[] {
  const safeTimezone = timezone.trim().length > 0 ? timezone : "UTC";
  try {
    return new Intl.DateTimeFormat("en-GB", { ...options, timeZone: safeTimezone }).formatToParts(date);
  } catch {
    return new Intl.DateTimeFormat("en-GB", { ...options, timeZone: "UTC" }).formatToParts(date);
  }
}

function readPart(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): number {
  return Number.parseInt(parts.find((part) => part.type === type)?.value ?? "0", 10);
}
