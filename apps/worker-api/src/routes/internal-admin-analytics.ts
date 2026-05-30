import { jsonResponse } from "../http/json";
import { verifyInternalRequest } from "../security/internal-auth";
import { methodNotAllowed, unauthorized } from "./response";
import type { Env } from "../types";

type Row = Record<string, unknown>;
type CountRow = { count: number };

export async function handleInternalAdminAnalytics(request: Request, env: Env): Promise<Response> {
  const auth = verifyInternalRequest(request, env);
  if (!auth.ok) return unauthorized(auth.error, "Internal API authorization failed.", request);
  if (request.method !== "GET") return methodNotAllowed(["GET"], request);

  const url = new URL(request.url);
  const rangeDays = clampInteger(Number(url.searchParams.get("rangeDays") ?? "30"), 1, 90, 30);
  const category = normalizeFilter(url.searchParams.get("category"));
  const since = new Date(Date.now() - rangeDays * 24 * 60 * 60 * 1000).toISOString();

  const [itemsCount, generatedCount, reviewCount, approvedCount, queueCount, publishedCount, mediaReadyCount, mediaFailedCount, promptCount] = await Promise.all([
    countItems(env, since, category),
    countGeneratedOutputs(env, since, category),
    countReviewMessages(env, since, category),
    countApprovedOutputs(env, since, category),
    countPublishQueue(env, since, category),
    countPublished(env, since, category),
    countMediaJobs(env, since, category, "ready"),
    countMediaJobs(env, since, category, "failed"),
    countPromptRuns(env, since, category)
  ]);

  const [queueHealth, mediaRows, promptRows, categoryPerformance, publishingTimeseries, recentFailures] = await Promise.all([
    groupPublishQueueByStatus(env, since, category),
    listMediaJobs(env, since, category),
    listPromptRuns(env, since, category),
    buildCategoryPerformance(env, since),
    countPublishedByDay(env, since, category),
    buildRecentFailures(env, since, category)
  ]);

  const mediaPerformance = summarizeMedia(mediaRows);
  const promptPerformance = summarizePromptRuns(promptRows);

  return jsonResponse({
    ok: true,
    generatedAt: new Date().toISOString(),
    rangeDays,
    category: category ?? "all",
    kpis: {
      ingested: itemsCount,
      generated: generatedCount,
      reviewsSent: reviewCount,
      approvedOrQueued: approvedCount,
      queued: queueCount,
      published: publishedCount,
      mediaReady: mediaReadyCount,
      mediaFailed: mediaFailedCount,
      promptRuns: promptCount,
      promptFailures: promptPerformance.failed,
      promptFallbackRate: promptPerformance.fallbackRate,
      mediaFailureRate: mediaPerformance.failureRate,
      averageMediaTotalMs: mediaPerformance.avgTotalMs
    },
    funnel: [
      { stage: "Ingested", count: itemsCount },
      { stage: "Generated", count: generatedCount },
      { stage: "Media ready", count: mediaReadyCount },
      { stage: "Review sent", count: reviewCount },
      { stage: "Approved / queued", count: approvedCount },
      { stage: "Queued", count: queueCount },
      { stage: "Published", count: publishedCount }
    ],
    queueHealth,
    mediaPerformance,
    promptPerformance,
    providerHealth: summarizeProviders(mediaRows),
    categoryPerformance,
    publishingTimeseries,
    topBlockers: recentFailures.slice(0, 8),
    recentFailures
  });
}

async function countItems(env: Env, since: string, category?: string): Promise<number> {
  if (!category) return count(env, "SELECT COUNT(*) AS count FROM items WHERE created_at >= ?", [since]);
  return count(env, `SELECT COUNT(DISTINCT i.id) AS count FROM items i JOIN telegram_generated_outputs g ON g.item_id = i.id JOIN telegram_routes r ON r.id = g.route_id WHERE i.created_at >= ? AND r.category = ?`, [since, category]);
}

async function countGeneratedOutputs(env: Env, since: string, category?: string): Promise<number> {
  return countWithCategory(env, "telegram_generated_outputs", "g", "g.created_at", since, category);
}

async function countApprovedOutputs(env: Env, since: string, category?: string): Promise<number> {
  const statuses = ["approved", "queued_for_publish", "scheduled", "publishing", "published"];
  const placeholders = statuses.map(() => "?").join(", ");
  if (!category) return count(env, `SELECT COUNT(*) AS count FROM telegram_generated_outputs WHERE created_at >= ? AND status IN (${placeholders})`, [since, ...statuses]);
  return count(env, `SELECT COUNT(*) AS count FROM telegram_generated_outputs g JOIN telegram_routes r ON r.id = g.route_id WHERE g.created_at >= ? AND g.status IN (${placeholders}) AND r.category = ?`, [since, ...statuses, category]);
}

async function countReviewMessages(env: Env, since: string, category?: string): Promise<number> {
  if (!category) return count(env, "SELECT COUNT(*) AS count FROM telegram_review_messages WHERE created_at >= ?", [since]);
  return count(env, `SELECT COUNT(*) AS count FROM telegram_review_messages rm JOIN telegram_routes r ON r.id = rm.route_id WHERE rm.created_at >= ? AND r.category = ?`, [since, category]);
}

async function countPublishQueue(env: Env, since: string, category?: string): Promise<number> {
  return countQueue(env, since, category, undefined);
}

async function countPublished(env: Env, since: string, category?: string): Promise<number> {
  return countQueue(env, since, category, "published");
}

async function countMediaJobs(env: Env, since: string, category: string | undefined, status: string): Promise<number> {
  if (!category) return count(env, "SELECT COUNT(*) AS count FROM media_processing_jobs WHERE created_at >= ? AND status = ?", [since, status]);
  return count(env, `SELECT COUNT(DISTINCT mj.id) AS count FROM media_processing_jobs mj JOIN telegram_generated_outputs g ON g.item_id = mj.item_id JOIN telegram_routes r ON r.id = g.route_id WHERE mj.created_at >= ? AND mj.status = ? AND r.category = ?`, [since, status, category]);
}

async function countPromptRuns(env: Env, since: string, category?: string): Promise<number> {
  if (!category) return count(env, "SELECT COUNT(*) AS count FROM prompt_runs WHERE created_at >= ?", [since]);
  return count(env, `SELECT COUNT(DISTINCT pr.id) AS count FROM prompt_runs pr LEFT JOIN telegram_generated_outputs g ON g.id = pr.generated_output_id OR g.item_id = pr.item_id LEFT JOIN telegram_routes r ON r.id = g.route_id WHERE pr.created_at >= ? AND r.category = ?`, [since, category]);
}

async function countQueue(env: Env, since: string, category?: string, status?: string): Promise<number> {
  const params: unknown[] = [since];
  let sql = "SELECT COUNT(*) AS count FROM telegram_publish_queue q";
  if (category) sql += " JOIN telegram_routes r ON r.id = q.route_id";
  sql += " WHERE q.created_at >= ?";
  if (status) { sql += " AND q.status = ?"; params.push(status); }
  if (category) { sql += " AND r.category = ?"; params.push(category); }
  return count(env, sql, params);
}

async function countWithCategory(env: Env, table: string, alias: string, dateColumn: string, since: string, category?: string): Promise<number> {
  if (!safeIdentifier(table) || !safeIdentifier(alias)) return 0;
  if (!category) return count(env, `SELECT COUNT(*) AS count FROM ${table} ${alias} WHERE ${dateColumn} >= ?`, [since]);
  return count(env, `SELECT COUNT(*) AS count FROM ${table} ${alias} JOIN telegram_routes r ON r.id = ${alias}.route_id WHERE ${dateColumn} >= ? AND r.category = ?`, [since, category]);
}

async function groupPublishQueueByStatus(env: Env, since: string, category?: string): Promise<Record<string, number>> {
  const params: unknown[] = [since];
  let sql = "SELECT q.status AS key, COUNT(*) AS count FROM telegram_publish_queue q";
  if (category) sql += " JOIN telegram_routes r ON r.id = q.route_id";
  sql += " WHERE q.created_at >= ?";
  if (category) { sql += " AND r.category = ?"; params.push(category); }
  sql += " GROUP BY q.status";
  return groupCount(env, sql, params);
}

async function listMediaJobs(env: Env, since: string, category?: string): Promise<Row[]> {
  const params: unknown[] = [since];
  let sql = "SELECT DISTINCT mj.* FROM media_processing_jobs mj";
  if (category) sql += " JOIN telegram_generated_outputs g ON g.item_id = mj.item_id JOIN telegram_routes r ON r.id = g.route_id";
  sql += " WHERE mj.created_at >= ?";
  if (category) { sql += " AND r.category = ?"; params.push(category); }
  sql += " ORDER BY mj.created_at DESC LIMIT 1000";
  return safeAll(env, sql, params);
}

async function listPromptRuns(env: Env, since: string, category?: string): Promise<Row[]> {
  const params: unknown[] = [since];
  let sql = "SELECT DISTINCT pr.* FROM prompt_runs pr";
  if (category) sql += " LEFT JOIN telegram_generated_outputs g ON g.id = pr.generated_output_id OR g.item_id = pr.item_id LEFT JOIN telegram_routes r ON r.id = g.route_id";
  sql += " WHERE pr.created_at >= ?";
  if (category) { sql += " AND r.category = ?"; params.push(category); }
  sql += " ORDER BY pr.created_at DESC LIMIT 1000";
  return safeAll(env, sql, params);
}

async function buildCategoryPerformance(env: Env, since: string): Promise<Row[]> {
  const routes = await safeAll(env, "SELECT id, category, enabled FROM telegram_routes ORDER BY category ASC", []);
  const categories = Array.from(new Set(routes.map((row) => String(row.category ?? "uncategorized"))));
  const rows: Row[] = [];
  for (const category of categories) {
    rows.push({
      category,
      routes: routes.filter((row) => row.category === category).length,
      generated: await countGeneratedOutputs(env, since, category),
      published: await countPublished(env, since, category),
      mediaFailed: await countMediaJobs(env, since, category, "failed"),
      promptRuns: await countPromptRuns(env, since, category)
    });
  }
  return rows;
}

async function countPublishedByDay(env: Env, since: string, category?: string): Promise<Row[]> {
  const params: unknown[] = [since];
  let sql = "SELECT substr(q.updated_at, 1, 10) AS day, COUNT(*) AS count FROM telegram_publish_queue q";
  if (category) sql += " JOIN telegram_routes r ON r.id = q.route_id";
  sql += " WHERE q.updated_at >= ? AND q.status = 'published'";
  if (category) { sql += " AND r.category = ?"; params.push(category); }
  sql += " GROUP BY day ORDER BY day ASC";
  return safeAll(env, sql, params);
}

async function buildRecentFailures(env: Env, since: string, category?: string): Promise<Row[]> {
  const failures: Row[] = [];
  const media = await listMediaJobs(env, since, category);
  failures.push(...media.filter((row) => row.status === "failed").slice(0, 10).map((row) => ({ kind: "media", id: row.id, status: row.status, error: row.error_message, createdAt: row.created_at })));
  const prompts = await listPromptRuns(env, since, category);
  failures.push(...prompts.filter((row) => row.status === "failed").slice(0, 10).map((row) => ({ kind: "prompt", id: row.id, status: row.status, error: row.error_message, createdAt: row.created_at })));
  const queue = await safeAll(env, `SELECT q.id, q.status, q.last_error, q.created_at FROM telegram_publish_queue q${category ? " JOIN telegram_routes r ON r.id = q.route_id" : ""} WHERE q.created_at >= ? AND q.status = 'failed'${category ? " AND r.category = ?" : ""} ORDER BY q.updated_at DESC LIMIT 10`, category ? [since, category] : [since]);
  failures.push(...queue.map((row) => ({ kind: "publish", id: row.id, status: row.status, error: row.last_error, createdAt: row.created_at })));
  return failures.sort((left, right) => String(right.createdAt ?? "").localeCompare(String(left.createdAt ?? ""))).slice(0, 20);
}

function summarizeMedia(rows: Row[]): Record<string, unknown> {
  const total = rows.length;
  const failed = rows.filter((row) => row.status === "failed").length;
  const ready = rows.filter((row) => row.status === "ready").length;
  const timings = rows.map((row) => readTimings(row.output_json));
  const totalMs = timings.map((entry) => entry.totalMs).filter(isFiniteNumber);
  const downloadMs = timings.map((entry) => entry.downloadMs).filter(isFiniteNumber);
  const uploadMs = timings.map((entry) => entry.telegramUploadMs).filter(isFiniteNumber);
  const aspectWarnings = rows.filter((row) => JSON.stringify(parseJson(row.output_json)).includes("aspect_drift") || JSON.stringify(parseJson(row.output_json)).includes("aspect drift")).length;
  return {
    total,
    ready,
    failed,
    failureRate: total === 0 ? 0 : round(failed / total),
    successRate: total === 0 ? 0 : round(ready / total),
    avgTotalMs: average(totalMs),
    avgDownloadMs: average(downloadMs),
    avgUploadMs: average(uploadMs),
    aspectWarnings
  };
}

function summarizePromptRuns(rows: Row[]): Record<string, unknown> {
  const total = rows.length;
  const failed = rows.filter((row) => row.status === "failed").length;
  const succeeded = rows.filter((row) => row.status === "succeeded" || row.status === "mocked").length;
  const byStatus = rows.reduce<Record<string, number>>((acc, row) => { const status = String(row.status ?? "unknown"); acc[status] = (acc[status] ?? 0) + 1; return acc; }, {});
  const byProvider = rows.reduce<Record<string, number>>((acc, row) => { const provider = String(row.provider ?? "unknown"); acc[provider] = (acc[provider] ?? 0) + 1; return acc; }, {});
  return { total, succeeded, failed, errorRate: total === 0 ? 0 : round(failed / total), fallbackRate: 0, byStatus, byProvider };
}

function summarizeProviders(rows: Row[]): Row[] {
  const stats = new Map<string, { provider: string; attempts: number; success: number; failed: number; totalMs: number }>();
  for (const row of rows) {
    const json = parseJson(row.output_json);
    const attempts = Array.isArray(json.providerAttempts) ? json.providerAttempts : [];
    for (const raw of attempts) {
      if (!isRecord(raw)) continue;
      const provider = String(raw.provider ?? "unknown");
      const current = stats.get(provider) ?? { provider, attempts: 0, success: 0, failed: 0, totalMs: 0 };
      current.attempts += 1;
      if (raw.status === "success") current.success += 1;
      if (raw.status === "failed") current.failed += 1;
      if (typeof raw.durationMs === "number") current.totalMs += raw.durationMs;
      stats.set(provider, current);
    }
  }
  return Array.from(stats.values()).map((entry) => ({ ...entry, avgMs: entry.attempts === 0 ? 0 : Math.round(entry.totalMs / entry.attempts) }));
}

function readTimings(value: unknown): Record<string, number | undefined> {
  const parsed = parseJson(value);
  const timings = isRecord(parsed.timings) ? parsed.timings : undefined;
  return {
    totalMs: readNumber(timings?.totalMs),
    downloadMs: readNumber(timings?.downloadMs),
    telegramUploadMs: readNumber(timings?.telegramUploadMs)
  };
}

async function count(env: Env, sql: string, params: unknown[]): Promise<number> {
  try { const row = await env.DB.prepare(sql).bind(...params).first<CountRow>(); return Number(row?.count ?? 0); } catch { return 0; }
}

async function groupCount(env: Env, sql: string, params: unknown[]): Promise<Record<string, number>> {
  try { const result = await env.DB.prepare(sql).bind(...params).all<{ key: string; count: number }>(); return Object.fromEntries((result.results ?? []).map((row: { key: string; count: number }) => [row.key, row.count])); } catch { return {}; }
}

async function safeAll(env: Env, sql: string, params: unknown[]): Promise<Row[]> {
  try { const result = await env.DB.prepare(sql).bind(...params).all<Row>(); return result.results ?? []; } catch { return []; }
}

function parseJson(value: unknown): Row {
  if (isRecord(value)) return value;
  if (typeof value !== "string") return {};
  try { const parsed = JSON.parse(value) as unknown; return isRecord(parsed) ? parsed : {}; } catch { return {}; }
}
function isRecord(value: unknown): value is Row { return typeof value === "object" && value !== null && !Array.isArray(value); }
function readNumber(value: unknown): number | undefined { return typeof value === "number" && Number.isFinite(value) ? value : undefined; }
function isFiniteNumber(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value); }
function average(values: number[]): number { return values.length === 0 ? 0 : Math.round(values.reduce((sum, value) => sum + value, 0) / values.length); }
function round(value: number): number { return Math.round(value * 1000) / 1000; }
function safeIdentifier(value: string): boolean { return /^[a-z_]+$/i.test(value); }
function normalizeFilter(value: string | null): string | undefined { const trimmed = value?.trim(); return trimmed && trimmed !== "all" ? trimmed : undefined; }
function clampInteger(value: number, min: number, max: number, fallback: number): number { if (!Number.isFinite(value)) return fallback; return Math.max(min, Math.min(max, Math.floor(value))); }
