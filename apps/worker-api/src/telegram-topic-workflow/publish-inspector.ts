import { MediaAssetsRepository, MediaProcessingJobsRepository, PromptProfilesRepository, TelegramGeneratedOutputsRepository, TelegramPublishQueueRepository, TelegramReviewMessagesRepository, TelegramRoutesRepository, type MediaAssetRecord, type MediaProcessingJobRecord, type TelegramGeneratedOutputRecord, type TelegramPublishQueueRecord, type TelegramRouteOutputRecord } from "@curator/db";
import type { Env } from "../types";
import { applyRouteOutputSignature } from "./channel-signature";

export type PublishMediaStatus = "none" | "ready" | "pending" | "failed" | "partial" | "warning";

export type PublishMediaSummary = {
  status: PublishMediaStatus;
  assetCount: number;
  readyAssetCount: number;
  pendingJobCount: number;
  failedJobCount: number;
  skippedJobCount: number;
  photoCount: number;
  videoCount: number;
  documentCount: number;
  aspectWarningCount: number;
  warnings: string[];
  assets: Array<Record<string, unknown>>;
  jobs: Array<Record<string, unknown>>;
};

export type PublishPreview = {
  ok: boolean;
  queueId: string;
  generatedOutputId: string;
  itemId: string;
  routeId: string;
  routeOutputId: string;
  category: string;
  language: string;
  finalChatId: string;
  finalThreadId?: number;
  queueStatus: string;
  captionPreview: string;
  prompt: Record<string, unknown>;
  media: PublishMediaSummary;
  policy: Record<string, unknown>;
  warnings: string[];
  blockers: string[];
  canPublishNow: boolean;
};

export async function buildPublishPreview(env: Env, locator: { queueId?: string; generatedOutputId?: string }): Promise<PublishPreview | null> {
  const queueRepository = new TelegramPublishQueueRepository(env.DB);
  const queueItem = locator.queueId
    ? await queueRepository.findById(locator.queueId)
    : locator.generatedOutputId ? await queueRepository.findByGeneratedOutputId(locator.generatedOutputId) : null;
  if (!queueItem) return null;
  return buildPublishPreviewForQueueItem(env, queueItem);
}

export async function buildPublishPreviewForQueueItem(env: Env, queueItem: TelegramPublishQueueRecord): Promise<PublishPreview> {
  const generatedOutputsRepository = new TelegramGeneratedOutputsRepository(env.DB);
  const routesRepository = new TelegramRoutesRepository(env.DB);
  const generatedOutput = await generatedOutputsRepository.findById(queueItem.generatedOutputId);
  const routeOutput = generatedOutput ? await routesRepository.findOutputById(generatedOutput.routeOutputId) : await routesRepository.findOutputById(queueItem.routeOutputId);
  const route = routeOutput ? await routesRepository.findRouteById(routeOutput.routeId) : await routesRepository.findRouteById(queueItem.routeId);
  const media = await summarizeMediaForItem(env, queueItem.itemId);
  const prompt = generatedOutput ? await latestPromptRunForGeneratedOutput(env, generatedOutput.id, generatedOutput) : {};
  const caption = generatedOutput && routeOutput ? applyRouteOutputSignature(generatedOutput.output.caption, routeOutput) : generatedOutput?.output.caption ?? "";
  const warnings: string[] = [];
  const blockers: string[] = [];

  if (!generatedOutput) blockers.push("Generated output is missing.");
  if (!routeOutput) blockers.push("Route output is missing.");
  if (routeOutput && !routeOutput.publishEnabled) blockers.push("Publishing is disabled for this output.");
  if (media.status === "pending" || media.status === "partial") blockers.push("Media is not fully ready.");
  if (media.status === "failed" && env.MEDIA_FINAL_ALLOW_TEXT_FALLBACK !== "true") blockers.push("Media failed and text fallback is disabled for final publishing.");
  if (media.aspectWarningCount > 0) warnings.push(`${media.aspectWarningCount} media asset(s) have aspect warnings.`);
  if (prompt.fallbackUsed === true) warnings.push("Prompt fallback was used for this output.");
  if (queueItem.status !== "pending" && queueItem.status !== "scheduled" && queueItem.status !== "failed") blockers.push(`Queue status ${queueItem.status} is not actionable.`);

  return {
    ok: blockers.length === 0,
    queueId: queueItem.id,
    generatedOutputId: queueItem.generatedOutputId,
    itemId: queueItem.itemId,
    routeId: queueItem.routeId,
    routeOutputId: queueItem.routeOutputId,
    category: route?.category ?? "unknown",
    language: queueItem.language,
    finalChatId: queueItem.finalChatId,
    ...(queueItem.finalThreadId === undefined ? {} : { finalThreadId: queueItem.finalThreadId }),
    queueStatus: queueItem.status,
    captionPreview: caption.slice(0, 1600),
    prompt,
    media,
    policy: routeOutput ? routeOutputPolicy(routeOutput) : {},
    warnings,
    blockers,
    canPublishNow: blockers.length === 0
  };
}

export async function enrichQueueItemForDashboard(env: Env, queueItem: TelegramPublishQueueRecord): Promise<Record<string, unknown>> {
  const preview = await buildPublishPreviewForQueueItem(env, queueItem);
  return {
    queueId: queueItem.id,
    itemId: queueItem.itemId,
    generatedOutputId: queueItem.generatedOutputId,
    routeId: queueItem.routeId,
    routeOutputId: queueItem.routeOutputId,
    category: preview.category,
    language: queueItem.language,
    finalChatId: queueItem.finalChatId,
    finalThreadId: queueItem.finalThreadId,
    status: queueItem.status,
    scheduledFor: queueItem.scheduledFor,
    priority: queueItem.priority,
    attemptCount: queueItem.attemptCount,
    lastError: queueItem.lastError,
    finalMessageId: queueItem.finalMessageId,
    createdAt: queueItem.createdAt,
    updatedAt: queueItem.updatedAt,
    mediaStatus: preview.media.status,
    mediaAssetCount: preview.media.assetCount,
    mediaReadyAssetCount: preview.media.readyAssetCount,
    mediaPendingJobCount: preview.media.pendingJobCount,
    mediaFailedJobCount: preview.media.failedJobCount,
    mediaAspectWarningCount: preview.media.aspectWarningCount,
    promptProfileId: typeof preview.prompt.promptProfileId === "string" ? preview.prompt.promptProfileId : undefined,
    promptStatus: typeof preview.prompt.status === "string" ? preview.prompt.status : undefined,
    promptFallbackUsed: preview.prompt.fallbackUsed === true,
    publishWarnings: preview.warnings,
    publishBlockers: preview.blockers
  };
}

export async function summarizeMediaForItem(env: Env, itemId: string): Promise<PublishMediaSummary> {
  const assetsRepository = new MediaAssetsRepository(env.DB);
  const jobsRepository = new MediaProcessingJobsRepository(env.DB);
  const [assets, jobs] = await Promise.all([assetsRepository.findByItemId(itemId), jobsRepository.listByItemId(itemId)]);
  const pendingJobs = jobs.filter((job) => job.status === "pending" || job.status === "dispatching" || job.status === "dispatched" || job.status === "processing");
  const failedJobs = jobs.filter((job) => job.status === "failed");
  const skippedJobs = jobs.filter((job) => job.status === "skipped");
  const readyAssets = assets.filter((asset) => asset.telegramFileId !== undefined && asset.status !== "failed");
  const photoCount = readyAssets.filter((asset) => normalizeKind(asset) === "photo").length;
  const videoCount = readyAssets.filter((asset) => normalizeKind(asset) === "video" || normalizeKind(asset) === "animation").length;
  const documentCount = readyAssets.filter((asset) => normalizeKind(asset) === "document").length;
  const aspectWarnings = readAspectWarnings(assets, jobs);
  const warnings: string[] = [...aspectWarnings];

  let status: PublishMediaStatus = "none";
  if (assets.length > 0 || jobs.length > 0) {
    if (pendingJobs.length > 0) status = readyAssets.length > 0 ? "partial" : "pending";
    else if (failedJobs.length > 0 && readyAssets.length === 0) status = "failed";
    else if (failedJobs.length > 0 || skippedJobs.length > 0 || aspectWarnings.length > 0) status = readyAssets.length > 0 ? "warning" : "failed";
    else status = "ready";
  }

  return {
    status,
    assetCount: assets.length,
    readyAssetCount: readyAssets.length,
    pendingJobCount: pendingJobs.length,
    failedJobCount: failedJobs.length,
    skippedJobCount: skippedJobs.length,
    photoCount,
    videoCount,
    documentCount,
    aspectWarningCount: aspectWarnings.length,
    warnings,
    assets: assets.map(assetToSummary),
    jobs: jobs.map(jobToSummary)
  };
}

export async function buildItemTimeline(env: Env, input: { itemId?: string; generatedOutputId?: string; queueId?: string; sourceUrl?: string }): Promise<Record<string, unknown>> {
  const itemId = input.itemId ?? await resolveItemId(env, input);
  if (!itemId) return { ok: false, error: "item_not_found", events: [] };
  const events: Array<Record<string, unknown>> = [];
  const item = await safeFirst<Record<string, unknown>>(env, "SELECT * FROM items WHERE id = ? LIMIT 1", [itemId]);
  if (item) events.push(event("item_created", readRowString(item, "created_at"), { itemId, status: item.status, canonicalUrl: item.canonical_url, text: truncate(readRowString(item, "text"), 240) }));

  const generatedOutputs = await safeAll<Record<string, unknown>>(env, "SELECT * FROM telegram_generated_outputs WHERE item_id = ? ORDER BY created_at ASC", [itemId]);
  for (const output of generatedOutputs) events.push(event("generated_output", readRowString(output, "created_at"), { generatedOutputId: output.id, routeId: output.route_id, routeOutputId: output.route_output_id, language: output.language, status: output.status, error: output.error_message }));

  const runs = await safeAll<Record<string, unknown>>(env, "SELECT * FROM prompt_runs WHERE item_id = ? ORDER BY created_at ASC", [itemId]);
  for (const run of runs) events.push(event("prompt_run", readRowString(run, "created_at"), { promptRunId: run.id, promptProfileId: run.prompt_profile_id, status: run.status, model: run.model, generatedOutputId: run.generated_output_id, error: run.error_message }));

  const jobs = await safeAll<Record<string, unknown>>(env, "SELECT * FROM media_processing_jobs WHERE item_id = ? ORDER BY created_at ASC", [itemId]);
  for (const job of jobs) events.push(event("media_job", readRowString(job, "created_at"), { jobId: job.id, status: job.status, sourceUrl: job.source_url, workflowRunId: job.workflow_run_id, error: job.error_message, output: parseJson(readRowString(job, "output_json")) }));

  const reviews = await safeAll<Record<string, unknown>>(env, "SELECT * FROM telegram_review_messages WHERE item_id = ? ORDER BY created_at ASC", [itemId]);
  for (const review of reviews) events.push(event("review_sent", readRowString(review, "created_at"), { generatedOutputId: review.generated_output_id, routeOutputId: review.route_output_id, chatId: review.chat_id, threadId: review.thread_id, messageId: review.message_id, status: review.status }));

  const queue = await safeAll<Record<string, unknown>>(env, "SELECT * FROM telegram_publish_queue WHERE item_id = ? ORDER BY created_at ASC", [itemId]);
  for (const row of queue) events.push(event("publish_queue", readRowString(row, "created_at"), { queueId: row.id, generatedOutputId: row.generated_output_id, finalChatId: row.final_chat_id, status: row.status, scheduledFor: row.scheduled_for, finalMessageId: row.final_message_id, error: row.last_error }));

  return { ok: true, itemId, events: events.sort((left, right) => String(left.at ?? "").localeCompare(String(right.at ?? ""))) };
}

async function latestPromptRunForGeneratedOutput(env: Env, generatedOutputId: string, generatedOutput: TelegramGeneratedOutputRecord): Promise<Record<string, unknown>> {
  const run = await safeFirst<Record<string, unknown>>(env, "SELECT * FROM prompt_runs WHERE generated_output_id = ? OR (item_id = ? AND prompt_profile_id = ?) ORDER BY created_at DESC LIMIT 1", [generatedOutputId, generatedOutput.itemId, generatedOutput.promptProfile]);
  if (!run) return { promptProfileId: generatedOutput.promptProfile, model: generatedOutput.model, status: "unknown" };
  return {
    promptRunId: run.id,
    promptProfileId: run.prompt_profile_id,
    promptVersion: run.prompt_version,
    model: run.model,
    provider: run.provider,
    status: run.status,
    fallbackUsed: String(run.status ?? "").includes("fallback"),
    errorMessage: run.error_message,
    createdAt: run.created_at
  };
}

function routeOutputPolicy(routeOutput: TelegramRouteOutputRecord): Record<string, unknown> {
  return {
    publishEnabled: routeOutput.publishEnabled,
    publishMode: routeOutput.publishMode,
    timezone: routeOutput.timezone,
    allowedPublishWindows: routeOutput.allowedPublishWindows,
    minimumGapMinutes: routeOutput.minimumGapMinutes,
    maxPostsPerHour: routeOutput.maxPostsPerHour,
    maxPostsPerDay: routeOutput.maxPostsPerDay,
    queuePriority: routeOutput.queuePriority
  };
}

function normalizeKind(asset: MediaAssetRecord): string {
  const type = asset.telegramFileType ?? asset.kind;
  if (type === "photo" || type === "image") return "photo";
  if (type === "video" || type === "animation") return type;
  return "document";
}

function assetToSummary(asset: MediaAssetRecord): Record<string, unknown> {
  return {
    id: asset.id,
    kind: normalizeKind(asset),
    status: asset.status,
    sourceUrl: asset.sourceUrl,
    telegramFileIdConfigured: asset.telegramFileId !== undefined,
    mimeType: asset.telegramMimeType ?? asset.mimeType,
    sizeBytes: asset.telegramFileSize ?? asset.sizeBytes,
    width: asset.width,
    height: asset.height,
    durationSeconds: asset.durationSeconds,
    mediaGroupId: asset.telegramMediaGroupId,
    errorMessage: asset.errorMessage
  };
}

function jobToSummary(job: MediaProcessingJobRecord): Record<string, unknown> {
  const output = job.output ?? {};
  return {
    id: job.id,
    status: job.status,
    sourceUrl: job.sourceUrl,
    workflowRunId: job.workflowRunId ?? readString(output, "githubRunId"),
    githubRunUrl: readString(output, "githubRunUrl"),
    timings: isRecord(output.timings) ? output.timings : undefined,
    assetCount: readNumber(output, "storedAssetCount") ?? readNumber(output, "assetCount"),
    errorMessage: job.errorMessage
  };
}

function readAspectWarnings(assets: MediaAssetRecord[], jobs: MediaProcessingJobRecord[]): string[] {
  const warnings: string[] = [];
  for (const job of jobs) {
    const assetsOutput = Array.isArray(job.output.assets) ? job.output.assets : [];
    for (const entry of assetsOutput) {
      if (!isRecord(entry)) continue;
      const drift = readNumber(entry, "aspectDrift");
      if (drift !== undefined && drift > 0.02) warnings.push(`Asset aspect drift ${drift.toFixed(3)} in ${job.id}.`);
      const entryWarnings = Array.isArray(entry.warnings) ? entry.warnings.filter((value): value is string => typeof value === "string") : [];
      warnings.push(...entryWarnings.map((warning) => `${job.id}: ${warning}`));
    }
  }
  for (const asset of assets) {
    if (asset.width !== undefined && asset.height !== undefined && asset.width > 0 && asset.height > 0) continue;
    if (asset.telegramFileId !== undefined) warnings.push(`Asset ${asset.id} has file_id but missing dimensions.`);
  }
  return Array.from(new Set(warnings));
}

async function resolveItemId(env: Env, input: { generatedOutputId?: string; queueId?: string; sourceUrl?: string }): Promise<string | undefined> {
  if (input.queueId) {
    const row = await safeFirst<{ item_id: string }>(env, "SELECT item_id FROM telegram_publish_queue WHERE id = ? LIMIT 1", [input.queueId]);
    if (row?.item_id) return row.item_id;
  }
  if (input.generatedOutputId) {
    const row = await safeFirst<{ item_id: string }>(env, "SELECT item_id FROM telegram_generated_outputs WHERE id = ? LIMIT 1", [input.generatedOutputId]);
    if (row?.item_id) return row.item_id;
  }
  if (input.sourceUrl) {
    const row = await safeFirst<{ id: string }>(env, "SELECT id FROM items WHERE canonical_url = ? OR links_json LIKE ? OR raw_payload_json LIKE ? ORDER BY created_at DESC LIMIT 1", [input.sourceUrl, `%${input.sourceUrl}%`, `%${input.sourceUrl}%`]);
    if (row?.id) return row.id;
  }
  return undefined;
}

async function safeFirst<T>(env: Env, sql: string, binds: Array<string | number | boolean | null>): Promise<T | null> {
  try { return await env.DB.prepare(sql).bind(...binds).first<T>(); } catch { return null; }
}

async function safeAll<T>(env: Env, sql: string, binds: Array<string | number | boolean | null>): Promise<T[]> {
  try { const result = await env.DB.prepare(sql).bind(...binds).all<T>(); return result.results ?? []; } catch { return []; }
}

function event(kind: string, at: unknown, data: Record<string, unknown>): Record<string, unknown> {
  return { kind, at: typeof at === "string" ? at : undefined, ...data };
}

function readRowString(row: Record<string, unknown>, key: string): string | undefined {
  const value = row[key];
  return typeof value === "string" ? value : undefined;
}

function readString(value: Record<string, unknown>, key: string): string | undefined {
  const raw = value[key];
  return typeof raw === "string" && raw.trim().length > 0 ? raw : undefined;
}

function readNumber(value: Record<string, unknown>, key: string): number | undefined {
  const raw = value[key];
  return typeof raw === "number" && Number.isFinite(raw) ? raw : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJson(value: string | undefined): unknown {
  if (!value) return undefined;
  try { return JSON.parse(value); } catch { return undefined; }
}

function truncate(value: string | undefined, limit: number): string | undefined {
  if (!value) return undefined;
  return value.length > limit ? `${value.slice(0, limit)}…` : value;
}
