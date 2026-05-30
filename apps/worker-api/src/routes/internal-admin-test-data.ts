import { jsonResponse } from "../http/json";
import { verifyInternalRequest } from "../security/internal-auth";
import { badRequest, errorResponse, methodNotAllowed, parseJsonBody, unauthorized } from "./response";
import type { Env } from "../types";

type ResetScope = "dedupe_only" | "outputs_only" | "media_only" | "queue_only" | "reviews_only" | "all_operational" | "url_history";

type ResetBody = {
  scope?: ResetScope;
  confirm?: string;
  sourceUrl?: string;
};

type TableSpec = {
  table: string;
  group: "items" | "dedupe" | "media" | "outputs" | "queue" | "reviews" | "logs" | "wordpress";
  deleteOrder: number;
};

const CONFIRMATION = "RESET STAGING";

const TABLES: TableSpec[] = [
  { table: "telegram_review_messages", group: "reviews", deleteOrder: 10 },
  { table: "review_actions", group: "reviews", deleteOrder: 11 },
  { table: "review_messages", group: "reviews", deleteOrder: 12 },
  { table: "telegram_publish_queue", group: "queue", deleteOrder: 20 },
  { table: "publish_queue", group: "queue", deleteOrder: 21 },
  { table: "telegram_generated_outputs", group: "outputs", deleteOrder: 30 },
  { table: "outputs", group: "outputs", deleteOrder: 31 },
  { table: "media_processing_jobs", group: "media", deleteOrder: 40 },
  { table: "media_assets", group: "media", deleteOrder: 41 },
  { table: "provider_logs", group: "logs", deleteOrder: 50 },
  { table: "wordpress_posts", group: "wordpress", deleteOrder: 60 },
  { table: "dedupe_keys", group: "dedupe", deleteOrder: 70 },
  { table: "items", group: "items", deleteOrder: 80 }
];

export async function handleInternalAdminTestData(request: Request, env: Env): Promise<Response> {
  const auth = verifyInternalRequest(request, env);
  if (!auth.ok) return unauthorized(auth.error, "Internal API authorization failed.", request);

  const url = new URL(request.url);

  if (url.pathname === "/internal/admin/test-data/counts" && request.method === "GET") {
    return jsonResponse({ ok: true, environment: env.ENVIRONMENT ?? "unknown", stagingOnly: true, counts: await countOperationalTables(env) });
  }

  if (url.pathname === "/internal/admin/test-data/dedupe-search" && request.method === "POST") {
    const parsed = await parseJsonBody<{ sourceUrl?: unknown }>(request);
    if (!parsed.ok) return parsed.response;
    const sourceUrl = hasValue(parsed.value.sourceUrl) ? parsed.value.sourceUrl.trim() : "";
    if (!sourceUrl) return badRequest("source_url_required", "Provide sourceUrl to inspect dedupe history.", request);
    return jsonResponse({ ok: true, sourceUrl, result: await searchSourceUrlHistory(env, sourceUrl) });
  }

  if (url.pathname === "/internal/admin/test-data/reset" && request.method === "POST") {
    if ((env.ENVIRONMENT ?? "").toLowerCase() !== "staging") {
      return errorResponse({ status: 403, error: "reset_only_allowed_in_staging", message: "Operational test data reset is only allowed when ENVIRONMENT=staging.", request });
    }

    const parsed = await parseJsonBody<ResetBody>(request);
    if (!parsed.ok) return parsed.response;

    const scope = normalizeScope(parsed.value.scope);
    if (scope === undefined) return badRequest("invalid_reset_scope", "Choose a valid reset scope.", request);
    if (parsed.value.confirm !== CONFIRMATION) return badRequest("reset_confirmation_required", `Type ${CONFIRMATION} to continue.`, request);
    if (scope === "url_history" && !hasValue(parsed.value.sourceUrl)) return badRequest("source_url_required", "Provide sourceUrl for url_history reset.", request);

    const before = await countOperationalTables(env);
    const result = scope === "url_history"
      ? await resetSourceUrlHistory(env, parsed.value.sourceUrl?.trim() ?? "")
      : await resetScope(env, scope);
    const after = await countOperationalTables(env);

    return jsonResponse({ ok: true, environment: env.ENVIRONMENT ?? "unknown", scope, before, after, result, preserved: ["admin_config", "admin_config_audit", "settings", "sources", "prompt_profiles", "prompt_bindings", "telegram_routes", "telegram_route_outputs", "d1_migrations", "secrets"] });
  }

  return methodNotAllowed(["GET", "POST"], request);
}

async function countOperationalTables(env: Env): Promise<Record<string, number | string>> {
  const entries = await Promise.all(TABLES.map(async (spec) => [spec.table, await safeCount(env, spec.table)] as const));
  return Object.fromEntries(entries);
}

async function resetScope(env: Env, scope: ResetScope): Promise<{ deletedTables: string[]; skippedTables: string[] }> {
  const groups = scopeToGroups(scope);
  const specs = TABLES.filter((spec) => groups.has(spec.group)).sort((left, right) => left.deleteOrder - right.deleteOrder);
  const deletedTables: string[] = [];
  const skippedTables: string[] = [];
  for (const spec of specs) {
    const deleted = await safeDeleteAll(env, spec.table);
    (deleted ? deletedTables : skippedTables).push(spec.table);
  }
  return { deletedTables, skippedTables };
}

async function resetSourceUrlHistory(env: Env, sourceUrl: string): Promise<{ sourceUrl: string; deletedTables: string[]; skippedTables: string[]; matchedItemIds: string[] }> {
  const matchedItemIds = await findItemIdsForUrl(env, sourceUrl);
  if (matchedItemIds.length === 0) return { sourceUrl, deletedTables: [], skippedTables: TABLES.map((spec) => spec.table), matchedItemIds };

  const deletedTables: string[] = [];
  const skippedTables: string[] = [];
  const itemPlaceholders = matchedItemIds.map(() => "?").join(", ");
  const deleteSpecs: Array<{ table: string; sql: string; binds: string[] }> = [
    { table: "telegram_review_messages", sql: `DELETE FROM telegram_review_messages WHERE item_id IN (${itemPlaceholders})`, binds: matchedItemIds },
    { table: "telegram_publish_queue", sql: `DELETE FROM telegram_publish_queue WHERE item_id IN (${itemPlaceholders})`, binds: matchedItemIds },
    { table: "telegram_generated_outputs", sql: `DELETE FROM telegram_generated_outputs WHERE item_id IN (${itemPlaceholders})`, binds: matchedItemIds },
    { table: "review_actions", sql: `DELETE FROM review_actions WHERE item_id IN (${itemPlaceholders})`, binds: matchedItemIds },
    { table: "review_messages", sql: `DELETE FROM review_messages WHERE item_id IN (${itemPlaceholders})`, binds: matchedItemIds },
    { table: "publish_queue", sql: `DELETE FROM publish_queue WHERE item_id IN (${itemPlaceholders})`, binds: matchedItemIds },
    { table: "outputs", sql: `DELETE FROM outputs WHERE item_id IN (${itemPlaceholders})`, binds: matchedItemIds },
    { table: "media_processing_jobs", sql: `DELETE FROM media_processing_jobs WHERE item_id IN (${itemPlaceholders}) OR source_url = ?`, binds: [...matchedItemIds, sourceUrl] },
    { table: "media_assets", sql: `DELETE FROM media_assets WHERE item_id IN (${itemPlaceholders}) OR source_url = ? OR canonical_url = ?`, binds: [...matchedItemIds, sourceUrl, sourceUrl] },
    { table: "wordpress_posts", sql: `DELETE FROM wordpress_posts WHERE item_id IN (${itemPlaceholders})`, binds: matchedItemIds },
    { table: "dedupe_keys", sql: `DELETE FROM dedupe_keys WHERE item_id IN (${itemPlaceholders}) OR key_value = ?`, binds: [...matchedItemIds, sourceUrl] },
    { table: "items", sql: `DELETE FROM items WHERE id IN (${itemPlaceholders})`, binds: matchedItemIds }
  ];

  for (const spec of deleteSpecs) {
    const deleted = await safeRun(env, spec.sql, spec.binds);
    (deleted ? deletedTables : skippedTables).push(spec.table);
  }
  return { sourceUrl, deletedTables, skippedTables, matchedItemIds };
}

function scopeToGroups(scope: ResetScope): Set<TableSpec["group"]> {
  if (scope === "dedupe_only") return new Set(["dedupe"]);
  if (scope === "outputs_only") return new Set(["outputs", "reviews"]);
  if (scope === "media_only") return new Set(["media"]);
  if (scope === "queue_only") return new Set(["queue"]);
  if (scope === "reviews_only") return new Set(["reviews"]);
  return new Set(["items", "dedupe", "media", "outputs", "queue", "reviews", "logs", "wordpress"]);
}

async function safeCount(env: Env, table: string): Promise<number | string> {
  try {
    const row = await env.DB.prepare(`SELECT COUNT(*) AS count FROM ${table}`).first<{ count: number }>();
    return row?.count ?? 0;
  } catch {
    return "missing";
  }
}

async function safeDeleteAll(env: Env, table: string): Promise<boolean> {
  return safeRun(env, `DELETE FROM ${table}`, []);
}

async function safeRun(env: Env, sql: string, binds: string[]): Promise<boolean> {
  try {
    const statement = env.DB.prepare(sql);
    if (binds.length > 0) await statement.bind(...binds).run();
    else await statement.run();
    return true;
  } catch {
    return false;
  }
}

async function findItemIdsForUrl(env: Env, sourceUrl: string): Promise<string[]> {
  try {
    const result = await env.DB.prepare("SELECT id FROM items WHERE canonical_url = ? OR source_post_id = ? OR links_json LIKE ? OR raw_payload_json LIKE ? ORDER BY created_at DESC LIMIT 50")
      .bind(sourceUrl, sourceUrl, `%${sourceUrl}%`, `%${sourceUrl}%`)
      .all<{ id: string }>();
    return (result.results ?? []).map((row) => row.id);
  } catch {
    return [];
  }
}

async function searchSourceUrlHistory(env: Env, sourceUrl: string): Promise<Record<string, unknown>> {
  const matchedItemIds = await findItemIdsForUrl(env, sourceUrl);
  const itemPlaceholders = matchedItemIds.length > 0 ? matchedItemIds.map(() => "?").join(", ") : "''";
  const items = matchedItemIds.length === 0 ? [] : await safeSelect(env, `SELECT id, canonical_url, status, created_at, updated_at FROM items WHERE id IN (${itemPlaceholders}) ORDER BY created_at DESC LIMIT 25`, matchedItemIds);
  const dedupe = matchedItemIds.length === 0
    ? await safeSelect(env, "SELECT id, item_id, key_type, key_value, created_at FROM dedupe_keys WHERE key_value = ? ORDER BY created_at DESC LIMIT 25", [sourceUrl])
    : await safeSelect(env, `SELECT id, item_id, key_type, key_value, created_at FROM dedupe_keys WHERE item_id IN (${itemPlaceholders}) OR key_value = ? ORDER BY created_at DESC LIMIT 50`, [...matchedItemIds, sourceUrl]);
  const generatedOutputs = matchedItemIds.length === 0 ? [] : await safeSelect(env, `SELECT id, item_id, route_id, route_output_id, language, status, created_at, updated_at FROM telegram_generated_outputs WHERE item_id IN (${itemPlaceholders}) ORDER BY created_at DESC LIMIT 50`, matchedItemIds);
  const mediaJobs = matchedItemIds.length === 0
    ? await safeSelect(env, "SELECT id, item_id, status, source_url, workflow_run_id, error_message, created_at, updated_at FROM media_processing_jobs WHERE source_url = ? ORDER BY created_at DESC LIMIT 50", [sourceUrl])
    : await safeSelect(env, `SELECT id, item_id, status, source_url, workflow_run_id, error_message, created_at, updated_at FROM media_processing_jobs WHERE item_id IN (${itemPlaceholders}) OR source_url = ? ORDER BY created_at DESC LIMIT 50`, [...matchedItemIds, sourceUrl]);
  const publishQueue = matchedItemIds.length === 0 ? [] : await safeSelect(env, `SELECT id, item_id, generated_output_id, route_id, route_output_id, status, final_chat_id, scheduled_for, final_message_id, last_error, created_at, updated_at FROM telegram_publish_queue WHERE item_id IN (${itemPlaceholders}) ORDER BY created_at DESC LIMIT 50`, matchedItemIds);
  const reviewMessages = matchedItemIds.length === 0 ? [] : await safeSelect(env, `SELECT id, item_id, generated_output_id, route_output_id, language, status, chat_id, thread_id, message_id, created_at FROM telegram_review_messages WHERE item_id IN (${itemPlaceholders}) ORDER BY created_at DESC LIMIT 50`, matchedItemIds);
  return { matchedItemIds, counts: { items: items.length, dedupeKeys: dedupe.length, generatedOutputs: generatedOutputs.length, mediaJobs: mediaJobs.length, publishQueue: publishQueue.length, reviewMessages: reviewMessages.length }, items, dedupe, generatedOutputs, mediaJobs, publishQueue, reviewMessages };
}

async function safeSelect(env: Env, sql: string, binds: string[]): Promise<Record<string, unknown>[]> {
  try {
    const statement = env.DB.prepare(sql);
    const result = binds.length > 0 ? await statement.bind(...binds).all<Record<string, unknown>>() : await statement.all<Record<string, unknown>>();
    return result.results ?? [];
  } catch {
    return [];
  }
}

function normalizeScope(scope: unknown): ResetScope | undefined {
  return scope === "dedupe_only" || scope === "outputs_only" || scope === "media_only" || scope === "queue_only" || scope === "reviews_only" || scope === "all_operational" || scope === "url_history" ? scope : undefined;
}

function hasValue(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
