import { jsonResponse } from "../http/json";
import { verifyInternalRequest } from "../security/internal-auth";
import { methodNotAllowed, unauthorized } from "./response";
import type { Env } from "../types";

type RecentOutputRow = {
  id: string;
  item_id: string;
  route_id: string;
  route_output_id: string;
  language: string;
  status: string;
  error_message: string | null;
  updated_at: string;
  category: string | null;
  final_chat_id: string | null;
  queue_status: string | null;
  scheduled_for: string | null;
  queue_error: string | null;
};

export async function handleInternalTelegramOutputsRecent(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET") return methodNotAllowed(["GET"], request);
  const auth = verifyInternalRequest(request, env);
  if (!auth.ok) return unauthorized(auth.error, "Internal API authorization failed.", request);

  const url = new URL(request.url);
  const limit = clampLimit(Number(url.searchParams.get("limit") ?? 20));
  const result = await env.DB.prepare(
    `SELECT g.id, g.item_id, g.route_id, g.route_output_id, g.language, g.status, g.error_message, g.updated_at,
            r.category, o.final_chat_id, q.status AS queue_status, q.scheduled_for, q.last_error AS queue_error
       FROM telegram_generated_outputs g
       LEFT JOIN telegram_routes r ON r.id = g.route_id
       LEFT JOIN telegram_route_outputs o ON o.id = g.route_output_id
       LEFT JOIN telegram_publish_queue q ON q.generated_output_id = g.id
      ORDER BY g.updated_at DESC
      LIMIT ?`
  ).bind(limit).all<RecentOutputRow>();

  return jsonResponse({ ok: true, outputs: (result.results ?? []).map(toSafeRecentOutput) });
}

function toSafeRecentOutput(row: RecentOutputRow): Record<string, unknown> {
  return {
    generatedOutputId: row.id,
    itemId: row.item_id,
    category: row.category ?? row.route_id,
    language: row.language,
    reviewStatus: row.status,
    publishQueueStatus: row.queue_status ?? "not_queued",
    scheduledFor: row.scheduled_for ?? undefined,
    finalChatId: row.final_chat_id ?? "not_configured",
    lastError: redactError(row.queue_error ?? row.error_message ?? ""),
    updatedAt: row.updated_at
  };
}

function clampLimit(value: number): number {
  if (!Number.isFinite(value)) return 20;
  return Math.min(100, Math.max(1, Math.floor(value)));
}

function redactError(value: string): string {
  if (!value) return "";
  return value.replace(/[0-9]{6,}:[A-Za-z0-9_-]+/g, "[redacted-token]").slice(0, 240);
}
