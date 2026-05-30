import { handleScheduledApifyCuration } from "../scheduled/apify-curation";
import { verifyInternalRequest } from "../security/internal-auth";
import { jsonResponse } from "../http/json";
import { getEffectiveEnv } from "../admin-config/service";
import type { Env } from "../types";

export async function handleInternalApifyCurationTrigger(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") {
    return jsonResponse({ ok: false, error: "method_not_allowed" }, { status: 405 });
  }

  const auth = verifyInternalRequest(request, env);
  if (!auth.ok) {
    return jsonResponse({ ok: false, error: auth.error }, { status: 403 });
  }

  const effectiveEnv = await getEffectiveEnv(env);

  // Support ?dryRun=true query param or JSON body { dryRun: true }
  const url = new URL(request.url);
  const dryRunParam = url.searchParams.get("dryRun") === "true";
  let dryRunBody = false;
  try {
    const body = await request.clone().json() as Record<string, unknown>;
    dryRunBody = body.dryRun === true;
  } catch { /* no body */ }

  if (dryRunParam || dryRunBody) {
    (effectiveEnv as unknown as Record<string, string>).APIFY_CURATION_DRY_RUN = "true";
  }
  // Force-enable for manual trigger even if config is disabled
  (effectiveEnv as unknown as Record<string, string>).APIFY_CURATION_ENABLED = "true";

  const result = await handleScheduledApifyCuration(effectiveEnv);

  return jsonResponse(result, { status: result.ok ? 200 : 500 });
}

export async function handleInternalApifyCrawlRuns(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET") {
    return jsonResponse({ ok: false, error: "method_not_allowed" }, { status: 405 });
  }

  const auth = verifyInternalRequest(request, env);
  if (!auth.ok) {
    return jsonResponse({ ok: false, error: auth.error }, { status: 403 });
  }

  const url = new URL(request.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 20, 1), 100);

  try {
    const runs = await env.DB.prepare(
      "SELECT * FROM apify_crawl_runs ORDER BY created_at DESC LIMIT ?"
    ).bind(limit).all();

    return jsonResponse({ ok: true, runs: runs.results ?? [] });
  } catch (error) {
    return jsonResponse({ ok: true, runs: [], error: "Table may not exist yet. Run D1 migration 0037." });
  }
}

export async function handleInternalApifyCurationDecisions(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET") {
    return jsonResponse({ ok: false, error: "method_not_allowed" }, { status: 405 });
  }

  const auth = verifyInternalRequest(request, env);
  if (!auth.ok) {
    return jsonResponse({ ok: false, error: auth.error }, { status: 403 });
  }

  const url = new URL(request.url);
  const runId = url.searchParams.get("runId");
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 50, 1), 200);

  try {
    const query = runId
      ? env.DB.prepare("SELECT * FROM claude_curation_decisions WHERE apify_crawl_run_id = ? ORDER BY claude_score DESC LIMIT ?").bind(runId, limit)
      : env.DB.prepare("SELECT * FROM claude_curation_decisions ORDER BY created_at DESC LIMIT ?").bind(limit);

    const decisions = await query.all();
    return jsonResponse({ ok: true, decisions: decisions.results ?? [] });
  } catch (error) {
    return jsonResponse({ ok: true, decisions: [], error: "Table may not exist yet. Run D1 migration 0037." });
  }
}

export async function handleInternalApifyCurationSources(request: Request, env: Env): Promise<Response> {
  const auth = verifyInternalRequest(request, env);
  if (!auth.ok) {
    return jsonResponse({ ok: false, error: auth.error }, { status: 403 });
  }

  if (request.method === "GET") {
    try {
      const sources = await env.DB.prepare("SELECT * FROM apify_curation_sources ORDER BY category, platform").all();
      return jsonResponse({ ok: true, sources: sources.results ?? [] });
    } catch {
      return jsonResponse({ ok: true, sources: [], error: "Table may not exist yet. Run D1 migration 0037." });
    }
  }

  if (request.method === "POST") {
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body || typeof body.category !== "string" || typeof body.platform !== "string" || typeof body.apifyDatasetId !== "string") {
      return jsonResponse({ ok: false, error: "Missing category, platform, or apifyDatasetId" }, { status: 400 });
    }
    const id = `src_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    try {
      await env.DB.prepare(
        "INSERT INTO apify_curation_sources (id, category, platform, apify_dataset_id, label, enabled) VALUES (?, ?, ?, ?, ?, 1)"
      ).bind(id, body.category, body.platform, body.apifyDatasetId, body.label ?? null).run();
      return jsonResponse({ ok: true, id });
    } catch (e) {
      return jsonResponse({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
    }
  }

  if (request.method === "DELETE") {
    const url = new URL(request.url);
    const sourceId = url.searchParams.get("id");
    if (!sourceId) return jsonResponse({ ok: false, error: "Missing id param" }, { status: 400 });
    try {
      await env.DB.prepare("DELETE FROM apify_curation_sources WHERE id = ?").bind(sourceId).run();
      return jsonResponse({ ok: true });
    } catch (e) {
      return jsonResponse({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
    }
  }

  return jsonResponse({ ok: false, error: "method_not_allowed" }, { status: 405 });
}
