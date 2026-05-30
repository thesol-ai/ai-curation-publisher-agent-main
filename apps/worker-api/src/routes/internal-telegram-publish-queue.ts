import { TELEGRAM_PUBLISH_QUEUE_STATUSES, TelegramPublishQueueRepository, type TelegramPublishQueueStatus } from "@curator/db";
import { getEffectiveEnv } from "../admin-config/service";
import { jsonResponse } from "../http/json";
import { verifyInternalRequest } from "../security/internal-auth";
import { publishTelegramQueueItem } from "../telegram-topic-workflow/publish-runner";
import { enrichQueueItemForDashboard } from "../telegram-topic-workflow/publish-inspector";
import { badRequest, methodNotAllowed, parseJsonBody, serverError, unauthorized } from "./response";
import type { Env } from "../types";

type QueueActionBody = {
  action?: unknown;
  queueId?: unknown;
  queueIds?: unknown;
  scheduledFor?: unknown;
};

export async function handleInternalTelegramPublishQueue(request: Request, env: Env): Promise<Response> {
  const auth = verifyInternalRequest(request, env);
  if (!auth.ok) return unauthorized(auth.error, "Internal API authorization failed.", request);

  if (request.method === "GET") return handleQueueList(request, env);
  if (request.method === "POST") return handleQueueAction(request, env);
  return methodNotAllowed(["GET", "POST"], request);
}

async function handleQueueList(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const limit = clampLimit(Number(url.searchParams.get("limit") ?? 25));
  const status = readQueueStatus(url.searchParams.get("status"));
  const effectiveEnv = await getEffectiveEnv(env);
  const repository = new TelegramPublishQueueRepository(effectiveEnv.DB);
  const queue = await repository.listRecent(limit, status);
  const enriched = await Promise.all(queue.map((item) => enrichQueueItemForDashboard(effectiveEnv, item)));

  return jsonResponse({ ok: true, queue: enriched.map((item) => ({ ...item, lastError: redactError(String(item.lastError ?? "")) })) });
}

async function handleQueueAction(request: Request, env: Env): Promise<Response> {
  const parsed = await parseJsonBody<QueueActionBody>(request);
  if (!parsed.ok) return parsed.response;
  const action = readString(parsed.value.action);
  if (!action) return badRequest("queue_action_missing", "Provide action: cancel, reschedule, or bulk_publish_now.", request);

  const effectiveEnv = await getEffectiveEnv(env);
  const repository = new TelegramPublishQueueRepository(effectiveEnv.DB);

  if (action === "cancel") {
    const queueId = readString(parsed.value.queueId);
    if (!queueId) return badRequest("queue_id_missing", "Provide queueId to cancel a publish queue item.", request);
    const item = await repository.findById(queueId);
    if (!item) return badRequest("publish_job_not_found", "No Telegram publish queue row matched the request.", request);
    if (item.status === "published" || item.status === "publishing") return badRequest("publish_job_not_cancellable", "Published or publishing rows cannot be cancelled.", request);
    await repository.markCancelled(item.id);
    return jsonResponse({ ok: true, action, queueId: item.id, status: "cancelled" });
  }

  if (action === "reschedule") {
    const queueId = readString(parsed.value.queueId);
    const scheduledFor = readString(parsed.value.scheduledFor);
    if (!queueId || !scheduledFor) return badRequest("reschedule_fields_missing", "Provide queueId and scheduledFor ISO timestamp.", request);
    const date = new Date(scheduledFor);
    if (Number.isNaN(date.getTime())) return badRequest("invalid_scheduled_for", "scheduledFor must be a valid ISO timestamp.", request);
    const item = await repository.findById(queueId);
    if (!item) return badRequest("publish_job_not_found", "No Telegram publish queue row matched the request.", request);
    if (item.status === "published" || item.status === "publishing") return badRequest("publish_job_not_reschedulable", "Published or publishing rows cannot be rescheduled.", request);
    await repository.reschedule(item.id, date.toISOString());
    return jsonResponse({ ok: true, action, queueId: item.id, status: "scheduled", scheduledFor: date.toISOString() });
  }

  if (action === "bulk_publish_now") {
    const queueIds = Array.isArray(parsed.value.queueIds) ? parsed.value.queueIds.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0).slice(0, 10) : [];
    if (queueIds.length === 0) return badRequest("queue_ids_missing", "Provide queueIds for bulk publish.", request);
    const results = [];
    for (const queueId of queueIds) {
      const item = await repository.findById(queueId);
      if (!item) { results.push({ ok: false, queueId, status: "missing" }); continue; }
      if (item.status !== "pending" && item.status !== "scheduled" && item.status !== "failed") { results.push({ ok: false, queueId, status: item.status, message: "Not actionable." }); continue; }
      try { results.push(await publishTelegramQueueItem({ env: effectiveEnv, queueItem: item })); }
      catch (error) { results.push({ ok: false, queueId, status: "failed", message: error instanceof Error ? error.message : "Publish failed." }); }
    }
    return jsonResponse({ ok: results.every((result) => result.ok), action, results }, { status: results.every((result) => result.ok) ? 200 : 207 });
  }

  return badRequest("unknown_queue_action", "Supported queue actions are cancel, reschedule, and bulk_publish_now.", request);
}

function toSafeQueueItem(item: Awaited<ReturnType<TelegramPublishQueueRepository["listRecent"]>>[number]): Record<string, unknown> {
  return {
    queueId: item.id,
    itemId: item.itemId,
    generatedOutputId: item.generatedOutputId,
    routeId: item.routeId,
    routeOutputId: item.routeOutputId,
    language: item.language,
    finalChatId: item.finalChatId,
    finalThreadId: item.finalThreadId,
    status: item.status,
    scheduledFor: item.scheduledFor,
    priority: item.priority,
    attemptCount: item.attemptCount,
    lastError: redactError(item.lastError ?? ""),
    finalMessageId: item.finalMessageId,
    updatedAt: item.updatedAt
  };
}

function readQueueStatus(value: string | null): TelegramPublishQueueStatus | undefined {
  return TELEGRAM_PUBLISH_QUEUE_STATUSES.includes(value as TelegramPublishQueueStatus) ? value as TelegramPublishQueueStatus : undefined;
}

function clampLimit(value: number): number {
  if (!Number.isFinite(value)) return 25;
  return Math.min(100, Math.max(1, Math.floor(value)));
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function redactError(value: string): string {
  if (!value) return "";
  return value.replace(/[0-9]{6,}:[A-Za-z0-9_-]+/g, "[redacted-token]").slice(0, 240);
}
