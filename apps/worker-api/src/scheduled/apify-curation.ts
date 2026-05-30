import type { NormalizedPost } from "@curator/core";
import {
  IngestGateService,
  SourcesRepository,
  TelegramGeneratedOutputsRepository,
  TelegramPublishQueueRepository,
  TelegramRoutesRepository,
  stableHash,
} from "@curator/db";
import { maybeDispatchExternalMediaProcessing } from "../telegram-topic-workflow/media-processing-orchestrator";
import { generateLocalizedTelegramOutput } from "../telegram-topic-workflow/output-orchestrator";
import { applyRouteOutputSignature } from "../telegram-topic-workflow/channel-signature";
import type { Env } from "../types";

// ============================================================
// TYPES
// ============================================================

type CurationSource = { id: string; category: string; platform: string; apifyDatasetId: string; label?: string };
type ApifyRawItem = { url: string; platform: string; handle: string; text: string; mediaUrls: string[]; timestamp: string; sourceDatasetId: string };
type ClaudeSelectedItem = { url: string; platform: string; handle: string; score: number; reason: string; mediaExpected: boolean; riskFlags: string[] };
type ClaudeSelectionOutput = { selectedItems: ClaudeSelectedItem[]; rejectedItems: Array<{ url: string; score: number; reason: string }>; totalProcessed: number };
type CategoryResult = { category: string; crawlRunId: string; ok: boolean; selectedCount: number; enqueuedCount: number; dedupeCount: number; failedCount: number; skippedReason?: string; claudeCallMade: boolean; claudeInputTokens?: number; claudeOutputTokens?: number; errors: string[] };

export type ApifyCurationResult = {
  ok: boolean;
  dryRun: boolean;
  categories: CategoryResult[];
  claudeCallsToday: number;
  errors: string[];
  timing: { totalMs: number };
};

type Config = {
  enabled: boolean;
  dryRun: boolean;
  apifyToken: string;
  thresholdScore: number;
  maxItemsPerSource: number;
  maxCandidatesForClaude: number;
  maxTextCharsPerItem: number;
  maxClaudeCallsPerDay: number;
  maxClaudeRetries: number;
  claudeModel: string;
  claudeMaxOutputTokens: number;
};

// ============================================================
// MAIN HANDLER — iterates categories
// ============================================================

export async function handleScheduledApifyCuration(env: Env): Promise<ApifyCurationResult> {
  const startTime = Date.now();
  const allErrors: string[] = [];

  try {
    const config = loadConfig(env);
    if (!config.enabled) {
      return { ok: true, dryRun: config.dryRun, categories: [], claudeCallsToday: 0, errors: [], timing: { totalMs: Date.now() - startTime } };
    }

    // Load curation sources from D1 (grouped by category)
    const sources = await loadCurationSources(env);
    if (sources.length === 0) {
      // Fallback: try legacy single APIFY_DATASET_ID
      const legacyDatasetId = getStr(env, "APIFY_DATASET_ID");
      if (legacyDatasetId) {
        sources.push({ id: "legacy_default", category: "default", platform: "mixed", apifyDatasetId: legacyDatasetId });
      } else {
        return { ok: true, dryRun: config.dryRun, categories: [], claudeCallsToday: 0, errors: ["No curation sources configured"], timing: { totalMs: Date.now() - startTime } };
      }
    }

    // Group sources by category
    const byCategory = new Map<string, CurationSource[]>();
    for (const src of sources) {
      const list = byCategory.get(src.category) ?? [];
      list.push(src);
      byCategory.set(src.category, list);
    }

    let callsToday = await countClaudeCallsToday(env);
    const categoryResults: CategoryResult[] = [];

    for (const [category, categorySources] of byCategory) {
      const catResult = await processCategoryRun(env, config, category, categorySources, callsToday);
      categoryResults.push(catResult);
      if (catResult.claudeCallMade) callsToday++;
      if (catResult.errors.length > 0) allErrors.push(...catResult.errors.map((e) => `[${category}] ${e}`));
    }

    return {
      ok: categoryResults.every((r) => r.ok),
      dryRun: config.dryRun,
      categories: categoryResults,
      claudeCallsToday: callsToday,
      errors: allErrors,
      timing: { totalMs: Date.now() - startTime },
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[ApifyCuration] Fatal:", msg);
    return { ok: false, dryRun: false, categories: [], claudeCallsToday: 0, errors: [`Fatal: ${msg}`], timing: { totalMs: Date.now() - startTime } };
  }
}

// ============================================================
// PROCESS ONE CATEGORY (merge all platform sources)
// ============================================================

async function processCategoryRun(env: Env, config: Config, category: string, sources: CurationSource[], callsToday: number): Promise<CategoryResult> {
  const errors: string[] = [];
  const crawlRunId = `run_${category}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const datasetIds = sources.map((s) => s.apifyDatasetId);
  let selectedCount = 0, enqueuedCount = 0, dedupeCount = 0, failedCount = 0;

  try {
    console.log(`[ApifyCuration][${category}] Started: ${crawlRunId}, sources: ${sources.length}`);

    // Check idempotency — skip if all datasets in this category already processed
    const allProcessed = await hasCategoryBeenProcessed(env, category, datasetIds);
    if (allProcessed) {
      console.log(`[ApifyCuration][${category}] Already processed — skipping`);
      return mkCatResult(category, crawlRunId, true, { skippedReason: "already_processed" });
    }

    // Check failure cooldown
    if (await hasRecentFailedRun(env, category, 30)) {
      return mkCatResult(category, crawlRunId, true, { skippedReason: "failure_cooldown" });
    }

    // Daily budget — call count
    if (callsToday >= config.maxClaudeCallsPerDay) {
      await saveCrawlRun(env, crawlRunId, category, datasetIds, "skipped_budget_limit", {});
      return mkCatResult(category, crawlRunId, true, { skippedReason: "daily_budget_reached" });
    }

    // Daily budget — token usage (if tracking is available)
    const tokensToday = await countClaudeTokensToday(env);
    const maxDailyTokens = Number(getStr(env, "CLAUDE_CURATION_DAILY_TOKEN_BUDGET")) || 100000;
    if (tokensToday >= maxDailyTokens) {
      await saveCrawlRun(env, crawlRunId, category, datasetIds, "skipped_budget_limit", {});
      return mkCatResult(category, crawlRunId, true, { skippedReason: "daily_token_budget_reached" });
    }

    // Fetch all datasets for this category and merge
    const fetchStart = Date.now();
    const allItems: ApifyRawItem[] = [];
    for (const src of sources) {
      try {
        const items = await fetchApifyDataset(config, src);
        allItems.push(...items);
      } catch (e) {
        errors.push(`Fetch ${src.platform}/${src.apifyDatasetId}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    const fetchMs = Date.now() - fetchStart;
    console.log(`[ApifyCuration][${category}] Fetched ${allItems.length} items from ${sources.length} sources (${fetchMs}ms)`);

    if (allItems.length === 0) {
      await saveCrawlRun(env, crawlRunId, category, datasetIds, "completed", { totalItems: 0 });
      return mkCatResult(category, crawlRunId, true, { skippedReason: "empty_datasets" });
    }

    // Pre-dedupe across all platforms
    const sourcesRepo = new SourcesRepository(env.DB);
    await sourcesRepo.ensureApifyCurationSource();
    const candidatesBeforeDedupe = allItems.length;
    const newCandidates = await filterAlreadyIngested(env, allItems);
    const candidatesAfterDedupe = newCandidates.length;
    dedupeCount = candidatesBeforeDedupe - candidatesAfterDedupe;

    if (newCandidates.length === 0) {
      await saveCrawlRun(env, crawlRunId, category, datasetIds, "completed", { totalItems: candidatesBeforeDedupe, itemsDedupeCount: dedupeCount });
      return mkCatResult(category, crawlRunId, true, { dedupeCount, skippedReason: "all_dedupe" });
    }

    // Cap candidates for Claude
    const candidatesForClaude = newCandidates.slice(0, config.maxCandidatesForClaude);

    // Dry-run guard
    if (config.dryRun) {
      await saveCrawlRun(env, crawlRunId, category, datasetIds, "dry_run", { totalItems: candidatesBeforeDedupe, candidatesAfterDedupe, candidatesSentToClaude: candidatesForClaude.length, itemsDedupeCount: dedupeCount });
      return mkCatResult(category, crawlRunId, true, { dedupeCount, skippedReason: "dry_run" });
    }

    // Call Claude — one call per category, ranking across all platforms
    await saveCrawlRun(env, crawlRunId, category, datasetIds, "processing", { totalItems: candidatesBeforeDedupe, candidatesSentToClaude: candidatesForClaude.length });

    const claudeStart = Date.now();
    const claudeResult = await callClaudeSelection(env, config, candidatesForClaude, category);
    const callClaudeMs = Date.now() - claudeStart;

    if (!claudeResult.ok) {
      errors.push(`Claude: ${claudeResult.error}`);
      await saveCrawlRun(env, crawlRunId, category, datasetIds, "failed", { totalItems: candidatesBeforeDedupe, claudeErrorMessage: claudeResult.error });
      return mkCatResult(category, crawlRunId, false, { errors, claudeCallMade: true });
    }

    selectedCount = claudeResult.data.selectedItems.length;

    // Process selected items — route to category's route/output
    const routesRepo = new TelegramRoutesRepository(env.DB);
    const routes = await routesRepo.listRoutes();
    const categoryRoute = routes.find((r) => r.category === category && r.enabled);

    if (!categoryRoute) {
      errors.push(`No route for category "${category}"`);
      await saveCrawlRun(env, crawlRunId, category, datasetIds, "failed", { totalItems: candidatesBeforeDedupe, claudeSelectedCount: selectedCount, claudeErrorMessage: `No route for category`, ...(claudeResult.inputTokens !== undefined ? { claudeInputTokens: claudeResult.inputTokens } : {}), ...(claudeResult.outputTokens !== undefined ? { claudeOutputTokens: claudeResult.outputTokens } : {}) });
      return mkCatResult(category, crawlRunId, false, { selectedCount, errors, claudeCallMade: true, ...(claudeResult.inputTokens !== undefined ? { claudeInputTokens: claudeResult.inputTokens } : {}), ...(claudeResult.outputTokens !== undefined ? { claudeOutputTokens: claudeResult.outputTokens } : {}) });
    }

    const routeOutputs = await routesRepo.listOutputsForRoute(categoryRoute.id);
    const enabledOutputs = routeOutputs.filter((o) => o.enabled);

    const ingestGate = new IngestGateService(env.DB);
    const outputsRepo = new TelegramGeneratedOutputsRepository(env.DB);
    const queueRepo = new TelegramPublishQueueRepository(env.DB);
    const apifyTextMap = new Map(allItems.map((ai) => [ai.url, ai.text]));

    for (const selected of claudeResult.data.selectedItems) {
      try {
        const originalText = apifyTextMap.get(selected.url) ?? selected.reason;
        const platform = normalizePlatform(selected.platform);
        const provider = platform === "instagram" ? "apify_instagram" : platform === "x" ? "apify_x" : "simple_extractor";

        const post: NormalizedPost = {
          provider, platform, sourceType: "profile",
          sourcePostId: extractPostId(selected.url), canonicalUrl: selected.url, authorHandle: selected.handle,
          text: originalText, links: [selected.url], media: [],
          rawPayload: { apifyCrawlRunId: crawlRunId, category, claudeScore: selected.score, claudeReason: selected.reason, mediaExpected: selected.mediaExpected, riskFlags: selected.riskFlags },
        };

        const gateResult = await ingestGate.process({ sourceId: "apify_curation", post });
        const itemIdForDecision = gateResult.outcome === "queued" ? gateResult.item.id : (gateResult.outcome === "duplicate" ? gateResult.existingItemId ?? null : null);
        await saveCurationDecision(env, crawlRunId, selected, itemIdForDecision ?? null, gateResult.outcome);

        if (gateResult.outcome === "duplicate") { dedupeCount++; continue; }
        if (gateResult.outcome === "invalid") { failedCount++; continue; }

        const item = gateResult.item;

        if (selected.mediaExpected) {
          try { await maybeDispatchExternalMediaProcessing({ env, itemId: item.id, sourceUrls: [selected.url], requestedBy: `apify_curation:${crawlRunId}` }); }
          catch { /* non-blocking */ }
        }

        let outputCount = 0;
        for (const routeOutput of enabledOutputs) {
          try {
            const localized = await generateLocalizedTelegramOutput({ env, itemId: item.id, route: categoryRoute, routeOutput, post, sourceAttributionText: "" });
            const reviewCaption = applyRouteOutputSignature(localized.output.caption, routeOutput);
            const genOut = await outputsRepo.save({
              itemId: item.id, routeId: categoryRoute.id, routeOutputId: routeOutput.id, language: routeOutput.language,
              status: "queued_for_publish", promptProfile: categoryRoute.promptProfile, model: localized.model,
              output: { ...localized.output, caption: reviewCaption },
              ...(localized.inputTokens !== undefined ? { inputTokens: localized.inputTokens } : {}),
              ...(localized.outputTokens !== undefined ? { outputTokens: localized.outputTokens } : {}),
            });
            if (routeOutput.publishEnabled && routeOutput.finalChatId) {
              // MEDIA GATE: if media is expected and MEDIA_FINAL_REQUIRE_READY is enforced,
              // defer enqueue until the media processing callback fires.
              // The output is saved with status "queued_for_publish" so that
              // maybePromoteOrphanedOutputsToQueue() in media-processing-orchestrator.ts
              // can find it and enqueue it automatically once all media jobs are terminal.
              const mediaFinalRequireReady = getStr(env, "MEDIA_FINAL_REQUIRE_READY") !== "false";
              const shouldDefer = selected.mediaExpected && mediaFinalRequireReady;
              if (shouldDefer) {
                console.log(`[ApifyCuration][${category}] Deferring publish queue for output ${genOut.id} — waiting for media ready on item ${item.id}`);
              } else {
                await queueRepo.enqueue({
                  itemId: item.id, generatedOutputId: genOut.id, routeId: categoryRoute.id, routeOutputId: routeOutput.id,
                  language: routeOutput.language, finalChatId: routeOutput.finalChatId,
                  ...(routeOutput.finalThreadId === undefined ? {} : { finalThreadId: routeOutput.finalThreadId }),
                  priority: routeOutput.queuePriority ?? 0,
                });
              }
            }
            outputCount++;
          } catch (e) { console.error(`[ApifyCuration][${category}] Output error:`, e); }
        }

        if (outputCount > 0) {
          enqueuedCount++;
          await logToSourceTopic(env, selected, item.id, crawlRunId, category, categoryRoute);
        } else { failedCount++; }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        errors.push(`${selected.url}: ${msg}`);
        failedCount++;
      }
    }

    // Store rejected decisions
    for (const rej of claudeResult.data.rejectedItems) {
      await saveCurationDecision(env, crawlRunId, { ...rej, handle: "", mediaExpected: false, riskFlags: [] }, null, "rejected");
    }

    await saveCrawlRun(env, crawlRunId, category, datasetIds, "completed", {
      totalItems: candidatesBeforeDedupe, candidatesAfterDedupe, candidatesSentToClaude: candidatesForClaude.length,
      claudeSelectedCount: selectedCount, claudeRejectedCount: claudeResult.data.rejectedItems.length,
      itemsQueuedCount: enqueuedCount, itemsDedupeCount: dedupeCount, itemsFailedCount: failedCount,
      ...(claudeResult.inputTokens !== undefined ? { claudeInputTokens: claudeResult.inputTokens } : {}),
      ...(claudeResult.outputTokens !== undefined ? { claudeOutputTokens: claudeResult.outputTokens } : {}),
    });

    console.log(`[ApifyCuration][${category}] Done — items: ${candidatesBeforeDedupe}→${candidatesAfterDedupe}→claude(${candidatesForClaude.length}), sel: ${selectedCount}, enq: ${enqueuedCount}, dup: ${dedupeCount}, fail: ${failedCount}`);

    return mkCatResult(category, crawlRunId, true, {
      selectedCount, enqueuedCount, dedupeCount, failedCount, errors, claudeCallMade: true,
      ...(claudeResult.inputTokens !== undefined ? { claudeInputTokens: claudeResult.inputTokens } : {}),
      ...(claudeResult.outputTokens !== undefined ? { claudeOutputTokens: claudeResult.outputTokens } : {}),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return mkCatResult(category, crawlRunId, false, { errors: [`Fatal: ${msg}`] });
  }
}

// ============================================================
// APIFY FETCH
// ============================================================

async function fetchApifyDataset(config: Config, source: CurationSource): Promise<ApifyRawItem[]> {
  if (!config.apifyToken) throw new Error("APIFY_TOKEN not configured");
  const url = `https://api.apify.com/v2/datasets/${source.apifyDatasetId}/items?token=${config.apifyToken}&limit=${config.maxItemsPerSource}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Apify ${response.status}: ${response.statusText}`);
  const raw = (await response.json()) as any[];
  return raw.slice(0, config.maxItemsPerSource).map((item) => ({
    url: item.url || item.link || item.postUrl || "",
    platform: (item.platform || source.platform || "unknown").toLowerCase(),
    handle: item.handle || item.username || item.ownerUsername || "",
    text: item.text || item.caption || item.description || "",
    mediaUrls: item.mediaUrls || item.imageUrls || item.images || [],
    timestamp: item.timestamp || item.publishedAt || new Date().toISOString(),
    sourceDatasetId: source.apifyDatasetId,
  })).filter((item) => item.url.length > 0);
}

// ============================================================
// CLAUDE API
// ============================================================

async function callClaudeSelection(env: Env, config: Config, items: ApifyRawItem[], category: string): Promise<{ ok: true; data: ClaudeSelectionOutput; inputTokens?: number; outputTokens?: number } | { ok: false; error: string }> {
  const apiKey = env.ANTHROPIC_API_KEY ?? (env as unknown as Record<string, unknown>).AI_API_KEY as string | undefined;
  if (!apiKey) return { ok: false, error: "ANTHROPIC_API_KEY not configured" };

  const systemPrompt = `You are an expert content curator for category "${category}". Analyze social posts from multiple platforms and select the best for republication. Scoring (0-100): Relevance 30%, Freshness 20%, Novelty 15%, Credibility 15%, Media 10%, Engagement 10%. Select items >= ${config.thresholdScore}. Return ONLY valid JSON: {"selectedItems":[{"url":"","platform":"","handle":"","score":0,"reason":"","mediaExpected":true,"riskFlags":[]}],"rejectedItems":[{"url":"","score":0,"reason":""}],"totalProcessed":0}`;

  const truncated = items.map((i) => ({ url: i.url, platform: i.platform, handle: i.handle, text: i.text.slice(0, config.maxTextCharsPerItem), mediaCount: i.mediaUrls.length, timestamp: i.timestamp }));
  const userPrompt = `Category: ${category}\nAnalyze ${truncated.length} items across platforms. Select those >= ${config.thresholdScore}. Max 50.\n\n${JSON.stringify(truncated)}`;

  let lastError = "";
  for (let attempt = 0; attempt <= config.maxClaudeRetries; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 2000 * attempt));
    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: config.claudeModel, max_tokens: config.claudeMaxOutputTokens, system: systemPrompt, messages: [{ role: "user", content: userPrompt }] }),
        signal: AbortSignal.timeout(60000),
      });
      if (!response.ok) { lastError = `Claude API ${response.status}`; continue; }

      const body = (await response.json()) as any;
      const rawText = body.content?.[0]?.text || "";
      const inputTokens: number | undefined = body.usage?.input_tokens;
      const outputTokens: number | undefined = body.usage?.output_tokens;

      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) { lastError = "No JSON in response"; continue; }

      const parsed = JSON.parse(jsonMatch[0]) as ClaudeSelectionOutput;
      if (!Array.isArray(parsed.selectedItems) || !Array.isArray(parsed.rejectedItems)) { lastError = "Invalid structure"; continue; }

      const knownUrls = new Set(items.map((i) => i.url));
      const validated: ClaudeSelectedItem[] = [];
      for (const sel of parsed.selectedItems) {
        if (typeof sel.url !== "string" || !knownUrls.has(sel.url)) continue;
        const score = typeof sel.score === "number" ? sel.score : Number(sel.score);
        if (Number.isNaN(score) || score < 0 || score > 100 || score < config.thresholdScore) continue;
        validated.push({ url: sel.url, platform: typeof sel.platform === "string" ? sel.platform : "unknown", handle: typeof sel.handle === "string" ? sel.handle : "", score, reason: typeof sel.reason === "string" ? sel.reason.slice(0, 500) : "", mediaExpected: typeof sel.mediaExpected === "boolean" ? sel.mediaExpected : true, riskFlags: Array.isArray(sel.riskFlags) ? sel.riskFlags.filter((f: unknown) => typeof f === "string") : [] });
      }

      const validatedRejected = parsed.rejectedItems.filter((r) => typeof r.url === "string" && r.url.length > 0).map((r) => ({ url: r.url, score: Math.max(0, Math.min(100, Number(r.score) || 0)), reason: typeof r.reason === "string" ? r.reason.slice(0, 500) : "" }));

      return { ok: true as const, data: { selectedItems: validated, rejectedItems: validatedRejected, totalProcessed: items.length }, ...(inputTokens !== undefined ? { inputTokens } : {}), ...(outputTokens !== undefined ? { outputTokens } : {}) };
    } catch (e) { lastError = e instanceof Error ? e.message : String(e); }
  }
  return { ok: false, error: lastError };
}

// ============================================================
// D1 HELPERS
// ============================================================

async function loadCurationSources(env: Env): Promise<CurationSource[]> {
  try {
    const result = await env.DB.prepare("SELECT * FROM apify_curation_sources WHERE enabled = 1 ORDER BY category, platform").all<{ id: string; category: string; platform: string; apify_dataset_id: string; label: string | null }>();
    return (result.results ?? []).map((r) => ({ id: r.id, category: r.category, platform: r.platform, apifyDatasetId: r.apify_dataset_id, ...(r.label ? { label: r.label } : {}) }));
  } catch { return []; }
}

async function saveCrawlRun(env: Env, id: string, category: string, datasetIds: string[], status: string, data: Record<string, unknown> = {}): Promise<void> {
  try {
    await env.DB.prepare(
      `INSERT INTO apify_crawl_runs (id, category, dataset_ids_json, total_items, candidates_after_dedupe, candidates_sent_to_claude, claude_selected_count, claude_rejected_count, claude_error_message, claude_input_tokens, claude_output_tokens, items_queued_count, items_dedupe_count, items_failed_count, status, processing_time_ms, fetch_apify_ms, call_claude_ms, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(id) DO UPDATE SET total_items=excluded.total_items, candidates_after_dedupe=excluded.candidates_after_dedupe, candidates_sent_to_claude=excluded.candidates_sent_to_claude, claude_selected_count=excluded.claude_selected_count, claude_rejected_count=excluded.claude_rejected_count, claude_error_message=excluded.claude_error_message, claude_input_tokens=excluded.claude_input_tokens, claude_output_tokens=excluded.claude_output_tokens, items_queued_count=excluded.items_queued_count, items_dedupe_count=excluded.items_dedupe_count, items_failed_count=excluded.items_failed_count, status=excluded.status, processing_time_ms=excluded.processing_time_ms, fetch_apify_ms=excluded.fetch_apify_ms, call_claude_ms=excluded.call_claude_ms, updated_at=CURRENT_TIMESTAMP`
    ).bind(
      id, category, JSON.stringify(datasetIds),
      (data.totalItems as number) ?? 0, (data.candidatesAfterDedupe as number) ?? 0, (data.candidatesSentToClaude as number) ?? 0,
      (data.claudeSelectedCount as number) ?? 0, (data.claudeRejectedCount as number) ?? 0,
      (data.claudeErrorMessage as string) ?? null,
      (data.claudeInputTokens as number) ?? null, (data.claudeOutputTokens as number) ?? null,
      (data.itemsQueuedCount as number) ?? 0, (data.itemsDedupeCount as number) ?? 0, (data.itemsFailedCount as number) ?? 0,
      status, (data.processingTimeMs as number) ?? null, (data.fetchApifyMs as number) ?? null, (data.callClaudeMs as number) ?? null,
    ).run();
  } catch (e) { console.error("[ApifyCuration] saveCrawlRun failed:", e); }
}

async function saveCurationDecision(env: Env, crawlRunId: string, item: { url: string; platform?: string; handle: string; score: number; reason: string; mediaExpected: boolean; riskFlags: string[] }, itemId: string | null, dedupeStatus: string): Promise<void> {
  try {
    const id = `cd_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await env.DB.prepare(
      `INSERT OR IGNORE INTO claude_curation_decisions (id, apify_crawl_run_id, item_id, source_url, platform, source_handle, claude_score, claude_reason, selected, media_expected, risk_flags_json, dedupe_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(id, crawlRunId, itemId, item.url, item.platform ?? "unknown", item.handle, item.score, item.reason, dedupeStatus === "queued" ? 1 : 0, item.mediaExpected ? 1 : 0, JSON.stringify(item.riskFlags), dedupeStatus).run();
  } catch (e) { console.error("[ApifyCuration] saveCurationDecision:", e); }
}

async function filterAlreadyIngested(env: Env, items: ApifyRawItem[]): Promise<ApifyRawItem[]> {
  const results: ApifyRawItem[] = [];
  for (const item of items) {
    try {
      const hash = stableHash(item.url);
      const existing = await env.DB.prepare("SELECT id FROM items WHERE canonical_url_hash = ?").bind(hash).first();
      if (!existing) results.push(item);
    } catch { results.push(item); }
  }
  return results;
}

async function hasCategoryBeenProcessed(env: Env, category: string, datasetIds: string[]): Promise<boolean> {
  try {
    const key = JSON.stringify(datasetIds.sort());
    const row = await env.DB.prepare("SELECT id FROM apify_crawl_runs WHERE category = ? AND dataset_ids_json = ? AND status = 'completed' LIMIT 1").bind(category, key).first<{ id: string }>();
    return row !== null;
  } catch { return false; }
}

async function hasRecentFailedRun(env: Env, category: string, cooldownMinutes: number): Promise<boolean> {
  try {
    const row = await env.DB.prepare("SELECT id FROM apify_crawl_runs WHERE category = ? AND status = 'failed' AND created_at > datetime('now', '-' || ? || ' minutes') LIMIT 1").bind(category, cooldownMinutes).first<{ id: string }>();
    return row !== null;
  } catch { return false; }
}

async function countClaudeCallsToday(env: Env): Promise<number> {
  try {
    const row = await env.DB.prepare("SELECT COUNT(*) as cnt FROM apify_crawl_runs WHERE status IN ('completed','failed','processing') AND created_at > datetime('now', '-1 day')").first<{ cnt: number }>();
    return row?.cnt ?? 0;
  } catch { return 0; }
}

async function countClaudeTokensToday(env: Env): Promise<number> {
  try {
    const row = await env.DB.prepare("SELECT COALESCE(SUM(COALESCE(claude_input_tokens, 0) + COALESCE(claude_output_tokens, 0)), 0) as total FROM apify_crawl_runs WHERE created_at > datetime('now', '-1 day')").first<{ total: number }>();
    return row?.total ?? 0;
  } catch { return 0; }
}

// ============================================================
// TELEGRAM SOURCE TOPIC LOG
// ============================================================

async function logToSourceTopic(env: Env, selected: ClaudeSelectedItem, itemId: string, crawlRunId: string, category: string, route: { sourceChatId: string; sourceThreadId: number }): Promise<void> {
  const botToken = env.TELEGRAM_BOT_TOKEN?.trim();
  if (!botToken || !route.sourceChatId) return;
  const text = `📋 Curated [${category}]\n\n${selected.platform} · @${selected.handle} · Score: ${selected.score}\n${selected.url}`;
  try {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: route.sourceChatId, ...(route.sourceThreadId ? { message_thread_id: route.sourceThreadId } : {}), text, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(5000),
    });
  } catch { /* non-blocking */ }
}

// ============================================================
// CONFIG & UTILS
// ============================================================

function loadConfig(env: Env): Config {
  return {
    enabled: getStr(env, "APIFY_CURATION_ENABLED") === "true",
    dryRun: getStr(env, "APIFY_CURATION_DRY_RUN") === "true",
    apifyToken: getStr(env, "APIFY_TOKEN"),
    thresholdScore: Number(getStr(env, "CLAUDE_CURATION_THRESHOLD_SCORE")) || 75,
    maxItemsPerSource: Number(getStr(env, "APIFY_MAX_ITEMS_PER_RUN")) || 100,
    maxCandidatesForClaude: Number(getStr(env, "CLAUDE_CURATION_MAX_CANDIDATES_PER_RUN")) || 50,
    maxTextCharsPerItem: Number(getStr(env, "CLAUDE_CURATION_MAX_TEXT_CHARS_PER_ITEM")) || 400,
    maxClaudeCallsPerDay: Number(getStr(env, "CLAUDE_CURATION_MAX_CALLS_PER_DAY")) || 3,
    maxClaudeRetries: Number(getStr(env, "CLAUDE_CURATION_MAX_RETRIES")) || 1,
    claudeModel: getStr(env, "CLAUDE_CURATION_MODEL") || "claude-sonnet-4-20250514",
    claudeMaxOutputTokens: Number(getStr(env, "CLAUDE_CURATION_MAX_OUTPUT_TOKENS")) || 4096,
  };
}

function getStr(env: Env, key: string): string { const v = (env as unknown as Record<string, unknown>)[key]; return typeof v === "string" ? v.trim() : ""; }
function normalizePlatform(p: string): "instagram" | "x" | "web" | "manual" { const l = p.toLowerCase(); return l === "instagram" ? "instagram" : l === "x" || l === "twitter" ? "x" : "web"; }
function extractPostId(url: string): string { try { return new URL(url).pathname.replace(/^\//, "").replace(/\/$/, ""); } catch { return url; } }

function mkCatResult(category: string, crawlRunId: string, ok: boolean, partial: Partial<Omit<CategoryResult, "category" | "crawlRunId" | "ok">> = {}): CategoryResult {
  return {
    category, crawlRunId, ok,
    selectedCount: partial.selectedCount ?? 0, enqueuedCount: partial.enqueuedCount ?? 0, dedupeCount: partial.dedupeCount ?? 0, failedCount: partial.failedCount ?? 0,
    ...(partial.skippedReason !== undefined ? { skippedReason: partial.skippedReason } : {}),
    claudeCallMade: partial.claudeCallMade ?? false,
    ...(partial.claudeInputTokens !== undefined ? { claudeInputTokens: partial.claudeInputTokens } : {}),
    ...(partial.claudeOutputTokens !== undefined ? { claudeOutputTokens: partial.claudeOutputTokens } : {}),
    errors: partial.errors ?? [],
  };
}
