import {
  MediaAssetsRepository,
  MediaProcessingJobsRepository,
  ItemsRepository,
  TelegramGeneratedOutputsRepository,
  TelegramReviewMessagesRepository,
  TelegramRoutesRepository,
  type CreateMediaAssetInput,
  type MediaAssetRecord,
  type MediaProcessingJobRecord,
  type MediaProcessingJobStatus,
  type TelegramGeneratedOutputRecord,
  type TelegramRouteOutputRecord,
  type TelegramRouteRecord
} from "@curator/db";
import { buildTelegramOutputReviewDraft, RealTelegramClient, type ParsedTelegramMedia } from "@curator/telegram";
import type { Env } from "../types";
import { applyRouteOutputSignature } from "./channel-signature";

export type MediaProcessingDispatchResult = {
  enabled: boolean;
  createdJobs: MediaProcessingJobRecord[];
  dispatchedJobs: string[];
  warnings: string[];
};

type EnvWithMediaProcessing = Env & {
  MEDIA_PROCESSING_MODE?: string;
  GITHUB_MEDIA_WORKFLOW_ENABLED?: string;
  GITHUB_MEDIA_WORKFLOW_DISPATCH_ENABLED?: string;
  GITHUB_MEDIA_REPO?: string;
  GITHUB_MEDIA_WORKFLOW_ID?: string;
  GITHUB_MEDIA_WORKFLOW_REF?: string;
  GITHUB_TOKEN?: string;
  WORKER_PUBLIC_BASE_URL?: string;
  GITHUB_MEDIA_PROCESSOR_ENABLED?: string;
  GITHUB_MEDIA_PROCESSOR_REPOSITORY?: string;
  GITHUB_MEDIA_PROCESSOR_WORKFLOW_ID?: string;
  GITHUB_MEDIA_PROCESSOR_REF?: string;
  GITHUB_MEDIA_PROCESSOR_TOKEN?: string;
  MEDIA_PROCESSOR_GH_TOKEN?: string;
  GITHUB_MEDIA_PROCESSOR_CALLBACK_URL?: string;
  INTERNAL_API_SECRET?: string;
  TELEGRAM_MEDIA_CACHE_CHAT_ID?: string;
  TELEGRAM_MEDIA_CACHE_THREAD_ID?: string;
  TELEGRAM_MEDIA_STAGING_CHAT_ID?: string;
  TELEGRAM_MEDIA_STAGING_THREAD_ID?: string;
  TELEGRAM_MEDIA_MAX_PHOTO_MB?: string;
  TELEGRAM_MEDIA_MAX_FILE_MB?: string;
  TELEGRAM_MEDIA_MAX_ASSETS?: string;
  MEDIA_MAX_ASSETS?: string;
  MEDIA_PROCESSING_STRICT?: string;
  GITHUB_MEDIA_PROCESSOR_STRICT?: string;
  MEDIA_REVIEW_WAIT_MODE?: string;
  MEDIA_REVIEW_ALLOW_PARTIAL?: string;
  MEDIA_FINAL_REQUIRE_READY?: string;
  MEDIA_FINAL_ALLOW_TEXT_FALLBACK?: string;
};

export type CallbackTimingPayload = {
  dispatchDelayMs?: number;
  downloadMs?: number;
  prepareMs?: number;
  telegramUploadMs?: number;
  callbackMs?: number;
  totalMs?: number;
  workflowStartedAt?: string;
  downloadStartedAt?: string;
  downloadFinishedAt?: string;
  prepareFinishedAt?: string;
  telegramUploadFinishedAt?: string;
  callbackSentAt?: string;
};

export type CompleteMediaProcessingJobInput = {
  jobId: string;
  status: "processing" | "ready" | "failed" | "skipped";
  errorMessage?: string;
  assets?: Array<{
    id?: string;
    index?: number;
    kind?: string;
    telegramFileId?: string;
    telegramFileUniqueId?: string;
    telegramMediaGroupId?: string;
    telegramFileType?: string;
    telegramMimeType?: string;
    telegramFileSize?: number;
    sourceUrl?: string;
    mimeType?: string;
    sizeBytes?: number;
    width?: number;
    height?: number;
    durationSeconds?: number;
    thumbnailTelegramFileId?: string;
    originalWidth?: number;
    originalHeight?: number;
    preparedWidth?: number;
    preparedHeight?: number;
    telegramWidth?: number;
    telegramHeight?: number;
    originalAspectRatio?: number;
    preparedAspectRatio?: number;
    telegramAspectRatio?: number;
    aspectDrift?: number;
    transcoded?: boolean;
    remuxed?: boolean;
    rotationApplied?: boolean;
    warnings?: string[];
  }>;
  timings?: CallbackTimingPayload;
  raw?: Record<string, unknown>;
};

type ItemMediaReadiness = {
  itemId: string;
  expectedJobs: number;
  readyJobs: number;
  failedJobs: number;
  skippedJobs: number;
  pendingJobs: number;
  readyAssets: number;
  status: "no_jobs" | "waiting" | "ready" | "ready_with_warnings" | "failed";
  warnings: string[];
  jobs: MediaProcessingJobRecord[];
};

export async function maybeDispatchExternalMediaProcessing(input: {
  env: Env;
  itemId: string;
  sourceUrls: string[];
  requestedBy?: string;
  fetchImpl?: typeof fetch;
}): Promise<MediaProcessingDispatchResult> {
  const env = input.env as EnvWithMediaProcessing;
  const enabled = env.MEDIA_PROCESSING_MODE === "github_actions" || env.GITHUB_MEDIA_WORKFLOW_ENABLED === "true" || env.GITHUB_MEDIA_PROCESSOR_ENABLED === "true";
  const warnings: string[] = [];
  const createdJobs: MediaProcessingJobRecord[] = [];
  const dispatchedJobs: string[] = [];
  if (!enabled) {
    return { enabled: false, createdJobs, dispatchedJobs, warnings };
  }

  const urls = mediaCandidateUrls(input.sourceUrls).slice(0, mediaProcessingSourceLimit(env));
  if (urls.length === 0) {
    return { enabled: true, createdJobs, dispatchedJobs, warnings };
  }

  const jobsRepository = new MediaProcessingJobsRepository(input.env.DB);
  for (const sourceUrl of urls) {
    const jobInput: Parameters<MediaProcessingJobsRepository["create"]>[0] = { itemId: input.itemId, sourceUrl };
    if (input.requestedBy !== undefined) jobInput.requestedBy = input.requestedBy;
    const job = await jobsRepository.create(jobInput);
    createdJobs.push(job);
    await jobsRepository.markDispatching(job.id);

    try {
      const dispatch = await dispatchGithubMediaWorkflow({
        env,
        job,
        fetchImpl: input.fetchImpl ?? safeFetch
      });

      if (dispatch.ok) {
        dispatchedJobs.push(job.id);
        await jobsRepository.markDispatched(job.id, dispatch.workflowRunId);
      } else {
        warnings.push(dispatch.warning);
        await jobsRepository.markFailed(job.id, dispatch.warning, { sourceUrl });
      }
    } catch (error) {
      const warning = `GitHub media workflow dispatch crashed for job ${job.id}: ${describeDispatchError(error)}`;
      warnings.push(warning);
      await jobsRepository.markFailed(job.id, warning, { sourceUrl });
    }
  }

  return { enabled: true, createdJobs, dispatchedJobs, warnings };
}

export async function dispatchExistingMediaProcessingJob(env: Env, jobId: string): Promise<{
  ok: boolean;
  jobId: string;
  status: string;
  message: string;
}> {
  const jobsRepository = new MediaProcessingJobsRepository(env.DB);
  const job = await jobsRepository.findById(jobId);

  if (!job) {
    return { ok: false, jobId, status: "missing", message: "Media processing job was not found." };
  }

  await jobsRepository.markDispatching(job.id);

  try {
    const dispatch = await dispatchGithubMediaWorkflow({
      env: env as EnvWithMediaProcessing,
      job,
      fetchImpl: safeFetch
    });

    if (dispatch.ok) {
      await jobsRepository.markDispatched(job.id, dispatch.workflowRunId);
      return { ok: true, jobId: job.id, status: "dispatched", message: "Media processing job dispatched." };
    }

    await jobsRepository.markFailed(job.id, dispatch.warning, { sourceUrl: job.sourceUrl });
    return { ok: false, jobId: job.id, status: "failed", message: dispatch.warning };
  } catch (error) {
    const message = `GitHub media workflow dispatch crashed for job ${job.id}: ${describeDispatchError(error)}`;
    await jobsRepository.markFailed(job.id, message, { sourceUrl: job.sourceUrl });
    return { ok: false, jobId: job.id, status: "failed", message };
  }
}

export async function cancelExistingMediaProcessingJob(env: Env, jobId: string): Promise<{
  ok: boolean;
  jobId: string;
  status: string;
  message: string;
}> {
  const jobsRepository = new MediaProcessingJobsRepository(env.DB);
  const job = await jobsRepository.findById(jobId);
  if (!job) {
    return { ok: false, jobId, status: "missing", message: "Media processing job was not found." };
  }
  if (job.status === "ready") {
    return { ok: false, jobId, status: job.status, message: "Ready media jobs cannot be cancelled." };
  }
  await jobsRepository.markSkipped(job.id, "Cancelled by operator from dashboard.", { cancelledBy: "dashboard", cancelledAt: new Date().toISOString() });
  await maybeSendMediaReviewWhenTerminal(env, job.itemId, job.sourceUrl);
  return { ok: true, jobId: job.id, status: "skipped", message: "Media processing job cancelled locally. A remote GitHub run may still finish, but late callbacks will not create duplicate reviews." };
}

export async function completeMediaProcessingJob(env: Env, body: CompleteMediaProcessingJobInput): Promise<{
  ok: boolean;
  jobId: string;
  status: string;
  storedAssetCount: number;
  message: string;
  readiness?: Omit<ItemMediaReadiness, "jobs">;
}> {
  const jobsRepository = new MediaProcessingJobsRepository(env.DB);
  const mediaAssetsRepository = new MediaAssetsRepository(env.DB);
  const job = await jobsRepository.findById(body.jobId);
  if (!job) {
    return { ok: false, jobId: body.jobId, status: "missing", storedAssetCount: 0, message: "Media processing job was not found." };
  }

  if (job.status === "skipped" && job.output.cancelledBy === "dashboard") {
    return { ok: true, jobId: job.id, status: "skipped", storedAssetCount: 0, message: "Ignored late media callback for a dashboard-cancelled job." };
  }

  if (body.status === "processing") {
    await jobsRepository.markProcessing(job.id, callbackOutputPatch(body));
    return { ok: true, jobId: job.id, status: "processing", storedAssetCount: 0, message: "Media processing is in progress." };
  }

  if (body.status !== "ready") {
    const message = safeError(body.errorMessage ?? `Media processing ${body.status}.`);
    if (body.status === "skipped") {
      await jobsRepository.markSkipped(job.id, message, callbackOutputPatch(body));
    } else {
      await jobsRepository.markFailed(job.id, message, callbackOutputPatch(body));
    }
    const readiness = await maybeSendMediaReviewWhenTerminal(env, job.itemId, job.sourceUrl);
    return { ok: body.status === "skipped", jobId: job.id, status: body.status, storedAssetCount: 0, message, ...(readiness === undefined ? {} : { readiness: publicReadiness(readiness) }) };
  }

  const assets = normalizeCallbackAssets(job, body.assets ?? []);
  if (assets.length === 0) {
    const message = "Media processor returned no Telegram file IDs.";
    await jobsRepository.markFailed(job.id, message, callbackOutputPatch(body));
    const readiness = await maybeSendMediaReviewWhenTerminal(env, job.itemId, job.sourceUrl);
    return { ok: false, jobId: job.id, status: "failed", storedAssetCount: 0, message, ...(readiness === undefined ? {} : { readiness: publicReadiness(readiness) }) };
  }

  await mediaAssetsRepository.createMany(assets);
  await jobsRepository.markReady(job.id, {
    ...callbackOutputPatch(body),
    storedAssetCount: assets.length,
    aspectSummary: summarizeAspectDrift(body.assets ?? [])
  });

  const reviewEvaluation = await safeMaybeSendMediaReviewWhenTerminal(env, jobsRepository, job.id, job.itemId, job.sourceUrl);

  return {
    ok: true,
    jobId: job.id,
    status: "ready",
    storedAssetCount: assets.length,
    message: reviewEvaluation.warning === undefined
      ? reviewEvaluation.readiness?.pendingJobs === 0
        ? "Media processing result stored and terminal item review evaluated."
        : "Media processing result stored. Waiting for other media jobs before review."
      : "Media processing result stored, but review delivery needs attention.",
    ...(reviewEvaluation.readiness === undefined ? {} : { readiness: publicReadiness(reviewEvaluation.readiness) }),
    ...(reviewEvaluation.warning === undefined ? {} : { warning: reviewEvaluation.warning })
  };
}

export async function evaluateMediaReadinessAndMaybeSendReview(env: Env, itemId: string, sourceUrl: string): Promise<Omit<ItemMediaReadiness, "jobs"> | undefined> {
  const readiness = await maybeSendMediaReviewWhenTerminal(env, itemId, sourceUrl);
  return readiness === undefined ? undefined : publicReadiness(readiness);
}

async function safeMaybeSendMediaReviewWhenTerminal(env: Env, jobsRepository: MediaProcessingJobsRepository, jobId: string, itemId: string, sourceUrl: string): Promise<{ readiness?: ItemMediaReadiness; warning?: string }> {
  try {
    const readiness = await maybeSendMediaReviewWhenTerminal(env, itemId, sourceUrl);
    return readiness === undefined ? {} : { readiness };
  } catch (error) {
    const warning = `Media is ready, but review delivery failed: ${safeError(error instanceof Error ? error.message : "unknown review delivery error")}`;
    const current = await jobsRepository.findById(jobId);
    const warnings = Array.isArray(current?.output.warnings)
      ? [...current.output.warnings.filter((entry): entry is string => typeof entry === "string"), warning]
      : [warning];
    await jobsRepository.markReady(jobId, { warnings, reviewDeliveryWarning: warning, reviewDeliveryWarningAt: new Date().toISOString() });
    return { warning };
  }
}

async function maybeSendMediaReviewWhenTerminal(env: Env, itemId: string, sourceUrl: string): Promise<ItemMediaReadiness | undefined> {
  const jobsRepository = new MediaProcessingJobsRepository(env.DB);
  const jobs = await jobsRepository.listByItemId(itemId);
  if (jobs.length === 0) return undefined;

  const readiness = await buildItemMediaReadiness(env, itemId, jobs);
  if (readiness.pendingJobs > 0 && mediaReviewWaitsForAllTerminal(env as EnvWithMediaProcessing)) {
    return readiness;
  }

  await sendMediaReadyReview(env, itemId, sourceUrl, readiness);
  return readiness;
}

async function buildItemMediaReadiness(env: Env, itemId: string, jobs: MediaProcessingJobRecord[]): Promise<ItemMediaReadiness> {
  const mediaAssetsRepository = new MediaAssetsRepository(env.DB);
  const assets = await mediaAssetsRepository.findByItemId(itemId);
  const readyAssets = assets.filter((asset) => asset.status === "ready" && asset.telegramFileId !== undefined).length;
  const readyJobs = jobs.filter((job) => job.status === "ready").length;
  const failedJobs = jobs.filter((job) => job.status === "failed").length;
  const skippedJobs = jobs.filter((job) => job.status === "skipped").length;
  const pendingJobs = jobs.filter((job) => !isTerminalMediaJobStatus(job.status)).length;
  const warnings = jobs.flatMap((job) => mediaJobWarnings(job));
  const status = jobs.length === 0
    ? "no_jobs"
    : pendingJobs > 0
      ? "waiting"
      : readyAssets > 0 && failedJobs === 0
        ? "ready"
        : readyAssets > 0
          ? "ready_with_warnings"
          : "failed";
  return { itemId, expectedJobs: jobs.length, readyJobs, failedJobs, skippedJobs, pendingJobs, readyAssets, status, warnings, jobs };
}

function isTerminalMediaJobStatus(status: MediaProcessingJobStatus): boolean {
  return status === "ready" || status === "failed" || status === "skipped";
}

function mediaReviewWaitsForAllTerminal(env: EnvWithMediaProcessing): boolean {
  return env.MEDIA_REVIEW_WAIT_MODE !== "partial_ready";
}

async function sendMediaReadyReview(env: Env, itemId: string, sourceUrl: string, readiness: ItemMediaReadiness): Promise<void> {
  const itemsRepository = new ItemsRepository(env.DB);
  const mediaAssetsRepository = new MediaAssetsRepository(env.DB);
  const generatedOutputsRepository = new TelegramGeneratedOutputsRepository(env.DB);
  const routesRepository = new TelegramRoutesRepository(env.DB);
  const reviewMessagesRepository = new TelegramReviewMessagesRepository(env.DB);

  const item = await itemsRepository.findById(itemId);
  if (!item) return;

  const assets = (await mediaAssetsRepository.findByItemId(itemId))
    .filter((asset) => asset.status === "ready" && asset.telegramFileId !== undefined);

  const media = assetsToParsedTelegramMedia(assets);
  const generatedOutputs = (await generatedOutputsRepository.listByItemId(itemId))
    .filter((output) => output.status === "ready_for_review" && output.output.caption.trim().length > 0);

  if (generatedOutputs.length === 0) return;

  const telegramClient = new RealTelegramClient({
    ...(env.TELEGRAM_BOT_TOKEN === undefined ? {} : { botToken: env.TELEGRAM_BOT_TOKEN })
  });

  for (const generatedOutput of generatedOutputs) {
    const existingReview = await reviewMessagesRepository.findByGeneratedOutputId(generatedOutput.id);
    if (existingReview?.status === "sent") continue;

    const route = await routesRepository.findRouteById(generatedOutput.routeId);
    const routeOutput = await routesRepository.findOutputById(generatedOutput.routeOutputId);
    if (!route || !routeOutput || !routeOutput.enabled) continue;

    await sendOneMediaReview({
      telegramClient,
      reviewMessagesRepository,
      generatedOutput,
      route,
      routeOutput,
      sourceUrl: item.canonicalUrl || sourceUrl,
      originalExcerpt: item.text ?? "",
      media,
      readiness
    });
  }
}

async function sendOneMediaReview(input: {
  telegramClient: RealTelegramClient;
  reviewMessagesRepository: TelegramReviewMessagesRepository;
  generatedOutput: TelegramGeneratedOutputRecord;
  route: TelegramRouteRecord;
  routeOutput: TelegramRouteOutputRecord;
  sourceUrl: string;
  originalExcerpt: string;
  media: ParsedTelegramMedia[];
  readiness: ItemMediaReadiness;
}): Promise<void> {
  const output = input.generatedOutput.output;
  const reviewCaption = applyRouteOutputSignature(output.caption, input.routeOutput);
  const riskFlags = [...output.riskFlags];
  if (input.readiness.status === "failed") riskFlags.push("media_failed", "text_fallback");
  if (input.readiness.status === "ready_with_warnings") riskFlags.push("media_ready_with_warnings");

  const draft = buildTelegramOutputReviewDraft({
    generatedOutputId: input.generatedOutput.id,
    category: input.route.category,
    language: input.routeOutput.language,
    itemId: input.generatedOutput.itemId,
    sourceUrl: input.sourceUrl,
    originalExcerpt: input.originalExcerpt,
    caption: reviewCaption,
    ...(output.summary === undefined ? {} : { summary: output.summary }),
    riskFlags,
    status: "ready_for_review",
    callbackToken: input.generatedOutput.id,
    scheduleSummary: createMediaReadyScheduleSummary(input.routeOutput),
    mediaSummary: createMediaReadinessSummary(input.readiness, input.media),
    hasPreviewMedia: input.media.length > 0,
    publishMode: input.routeOutput.publishMode,
    timezone: input.routeOutput.timezone,
    allowedPublishWindows: input.routeOutput.allowedPublishWindows,
    minimumGapMinutes: input.routeOutput.minimumGapMinutes,
    sourceButtonUrl: input.sourceUrl
  });

  const sent = await input.telegramClient.sendReviewMessage({
    chatId: input.routeOutput.reviewChatId,
    messageThreadId: input.routeOutput.reviewThreadId,
    text: draft.text,
    replyMarkup: draft.reply_markup,
    ...(input.media.length === 0 ? {} : { media: input.media }),
    mediaPreviewCaption: reviewCaption,
    sourceUrl: input.sourceUrl
  });

  await input.reviewMessagesRepository.create({
    generatedOutputId: input.generatedOutput.id,
    itemId: input.generatedOutput.itemId,
    routeId: input.route.id,
    routeOutputId: input.routeOutput.id,
    language: input.routeOutput.language,
    chatId: sent.chatId,
    threadId: input.routeOutput.reviewThreadId,
    messageId: sent.messageId,
    status: "sent"
  });
}

function assetsToParsedTelegramMedia(assets: MediaAssetRecord[]): ParsedTelegramMedia[] {
  return assets.flatMap((asset): ParsedTelegramMedia[] => {
    if (!asset.telegramFileId) return [];

    const kind = normalizeAssetTelegramKind(asset);
    return [{
      kind,
      fileId: asset.telegramFileId,
      ...(asset.telegramFileUniqueId === undefined ? {} : { fileUniqueId: asset.telegramFileUniqueId }),
      ...(asset.telegramMediaGroupId === undefined ? {} : { mediaGroupId: asset.telegramMediaGroupId }),
      ...(asset.telegramMimeType === undefined && asset.mimeType === undefined ? {} : { mimeType: asset.telegramMimeType ?? asset.mimeType }),
      ...(asset.telegramFileSize === undefined && asset.sizeBytes === undefined ? {} : { fileSize: asset.telegramFileSize ?? asset.sizeBytes }),
      ...(asset.width === undefined ? {} : { width: asset.width }),
      ...(asset.height === undefined ? {} : { height: asset.height }),
      ...(asset.durationSeconds === undefined ? {} : { durationSeconds: asset.durationSeconds })
    }];
  });
}

function normalizeAssetTelegramKind(asset: MediaAssetRecord): ParsedTelegramMedia["kind"] {
  if (asset.telegramFileType === "photo" || asset.kind === "image") return "photo";
  if (asset.telegramFileType === "animation") return "animation";
  if (asset.telegramFileType === "video" || asset.kind === "video") return "video";
  return "document";
}

function createMediaReadyScheduleSummary(routeOutput: TelegramRouteOutputRecord): string {
  return `${routeOutput.publishMode}; ${routeOutput.timezone}; window ${routeOutput.allowedPublishWindows.length > 0 ? routeOutput.allowedPublishWindows.join(", ") : "anytime"}; gap ${routeOutput.minimumGapMinutes}m; max ${routeOutput.maxPostsPerHour}/hour, ${routeOutput.maxPostsPerDay}/day`;
}

function createMediaReadinessSummary(readiness: ItemMediaReadiness, media: ParsedTelegramMedia[]): string {
  const parts = [
    `status ${readiness.status}`,
    `${media.length} ready asset${media.length === 1 ? "" : "s"}`,
    `jobs ${readiness.readyJobs}/${readiness.expectedJobs} ready, ${readiness.failedJobs} failed, ${readiness.skippedJobs} skipped`
  ];
  if (readiness.warnings.length > 0) parts.push(`warnings: ${readiness.warnings.slice(0, 3).join("; ")}`);
  if (readiness.status === "failed") parts.push("text-only fallback review sent because media processing reached a terminal failure state");
  return parts.join(" | ");
}

const safeFetch: typeof fetch = (request, init) => fetch(request, init);

function describeDispatchError(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) return `${error.name}: ${error.message}`.slice(0, 500);
  return "Unknown dispatch error.";
}

async function dispatchGithubMediaWorkflow(input: { env: EnvWithMediaProcessing; job: MediaProcessingJobRecord; fetchImpl: typeof fetch }): Promise<{ ok: true; workflowRunId?: string } | { ok: false; warning: string }> {
  const dispatchEnabled = input.env.GITHUB_MEDIA_WORKFLOW_DISPATCH_ENABLED === "true" || input.env.GITHUB_MEDIA_PROCESSOR_ENABLED === "true";
  if (!dispatchEnabled) {
    return { ok: false, warning: `Media job ${input.job.id} was created but GitHub workflow dispatch is disabled.` };
  }
  const repo = input.env.GITHUB_MEDIA_REPO?.trim() || input.env.GITHUB_MEDIA_PROCESSOR_REPOSITORY?.trim();
  const workflowId = input.env.GITHUB_MEDIA_WORKFLOW_ID?.trim() || input.env.GITHUB_MEDIA_PROCESSOR_WORKFLOW_ID?.trim() || "media-processor.yml";
  const token = input.env.MEDIA_PROCESSOR_GH_TOKEN?.trim()
    || input.env.GITHUB_MEDIA_PROCESSOR_TOKEN?.trim()
    || input.env.GITHUB_TOKEN?.trim();
  const stagingChatId = input.env.TELEGRAM_MEDIA_STAGING_CHAT_ID?.trim() || input.env.TELEGRAM_MEDIA_CACHE_CHAT_ID?.trim();
  const stagingThreadId = input.env.TELEGRAM_MEDIA_STAGING_THREAD_ID?.trim() || input.env.TELEGRAM_MEDIA_CACHE_THREAD_ID?.trim();
  const callbackBaseUrl = input.env.WORKER_PUBLIC_BASE_URL?.trim();
  const legacyCallback = input.env.GITHUB_MEDIA_PROCESSOR_CALLBACK_URL?.trim();
  const normalizedLegacyCallback = legacyCallback?.replace(/\/internal\/media\/processed$/, "/internal/media/processing/callback").replace(/\/internal\/media\/jobs\/complete$/, "/internal/media/processing/callback");
  const callbackUrl = normalizedLegacyCallback && normalizedLegacyCallback.includes("/internal/media/processing/callback")
    ? normalizedLegacyCallback
    : `${(callbackBaseUrl ?? normalizedLegacyCallback ?? "").replace(/\/$/, "")}/internal/media/processing/callback`;
  if (!repo || !token || !callbackUrl.startsWith("http") || !stagingChatId) {
    return { ok: false, warning: `Media job ${input.job.id} was created but GitHub media workflow config is incomplete.` };
  }
  const response = await input.fetchImpl(`https://api.github.com/repos/${repo}/actions/workflows/${encodeURIComponent(workflowId)}/dispatches`, {
    method: "POST",
    headers: {
      "accept": "application/vnd.github+json",
      "authorization": `Bearer ${token}`,
      "content-type": "application/json",
      "user-agent": "ai-curation-publisher-agent-media-dispatcher"
    },
    body: JSON.stringify({
      ref: input.env.GITHUB_MEDIA_WORKFLOW_REF?.trim() || input.env.GITHUB_MEDIA_PROCESSOR_REF?.trim() || "main",
      inputs: {
        job_id: input.job.id,
        item_id: input.job.itemId,
        source_url: input.job.sourceUrl,
        ...(input.job.mediaAssetId === undefined ? {} : { media_asset_id: input.job.mediaAssetId }),
        kind: input.job.kind,
        callback_url: callbackUrl,
        telegram_staging_chat_id: stagingChatId,
        ...(stagingThreadId === undefined ? {} : { telegram_staging_thread_id: stagingThreadId }),
        max_photo_mb: input.env.TELEGRAM_MEDIA_MAX_PHOTO_MB ?? "9",
        max_file_mb: input.env.TELEGRAM_MEDIA_MAX_FILE_MB ?? "49",
        max_assets: input.env.TELEGRAM_MEDIA_MAX_ASSETS ?? input.env.MEDIA_MAX_ASSETS ?? "10",
        strict_missing_media: input.env.GITHUB_MEDIA_PROCESSOR_STRICT ?? input.env.MEDIA_PROCESSING_STRICT ?? "false"
      }
    })
  });
  if (!response.ok) {
    const detail = await safeReadResponseText(response);
    return {
      ok: false,
      warning: detail.length > 0
        ? `GitHub media workflow dispatch failed for job ${input.job.id}: HTTP ${response.status} ${response.statusText}: ${detail}`
        : `GitHub media workflow dispatch failed for job ${input.job.id}: HTTP ${response.status} ${response.statusText}.`
    };
  }
  return { ok: true };
}

async function safeReadResponseText(response: Response): Promise<string> {
  try {
    return (await response.text()).replace(/\s+/g, " ").trim().slice(0, 800);
  } catch {
    return "";
  }
}

function normalizeCallbackAssets(job: MediaProcessingJobRecord, assets: NonNullable<CompleteMediaProcessingJobInput["assets"]>): CreateMediaAssetInput[] {
  const normalized: CreateMediaAssetInput[] = [];
  assets.forEach((asset, index) => {
    const telegramFileId = typeof asset.telegramFileId === "string" ? asset.telegramFileId.trim() : "";
    if (!telegramFileId) return;
    const telegramFileType = normalizeTelegramFileType(asset.telegramFileType ?? asset.kind);
    const kind = telegramFileType === "photo" ? "image" : telegramFileType === "video" || telegramFileType === "animation" ? "video" : "link_preview";
    const width = asset.telegramWidth ?? asset.preparedWidth ?? asset.width;
    const height = asset.telegramHeight ?? asset.preparedHeight ?? asset.height;
    normalized.push({
      id: asset.id ?? (index === 0 && job.mediaAssetId ? job.mediaAssetId : `media_job_${stableHash(`${job.id}:${index}:${telegramFileId}`)}`),
      itemId: job.itemId,
      kind,
      status: "ready",
      sourceUrl: asset.sourceUrl ?? job.sourceUrl,
      canonicalUrl: job.sourceUrl,
      ...(asset.mimeType === undefined ? {} : { mimeType: asset.mimeType }),
      ...(asset.sizeBytes === undefined ? {} : { sizeBytes: asset.sizeBytes }),
      ...(width === undefined ? {} : { width }),
      ...(height === undefined ? {} : { height }),
      ...(asset.durationSeconds === undefined ? {} : { durationSeconds: asset.durationSeconds }),
      telegramFileId,
      ...(asset.telegramFileUniqueId === undefined ? {} : { telegramFileUniqueId: asset.telegramFileUniqueId }),
      ...(asset.telegramMediaGroupId === undefined && assets.length <= 1 ? {} : { telegramMediaGroupId: asset.telegramMediaGroupId ?? `media_group_${stableHash(`${job.id}:${job.itemId}`)}` }),
      telegramFileType,
      ...(asset.telegramMimeType === undefined ? {} : { telegramMimeType: asset.telegramMimeType }),
      ...(asset.telegramFileSize === undefined ? {} : { telegramFileSize: asset.telegramFileSize })
    });
  });
  return normalized;
}

function normalizeTelegramFileType(value: string | undefined): "photo" | "video" | "animation" | "document" {
  if (value === "photo" || value === "image") return "photo";
  if (value === "video") return "video";
  if (value === "animation") return "animation";
  return "document";
}

function callbackOutputPatch(body: CompleteMediaProcessingJobInput): Record<string, unknown> {
  return {
    ...(body.raw === undefined ? {} : body.raw),
    ...(body.timings === undefined ? {} : { timings: body.timings }),
    ...(body.assets === undefined ? {} : { assets: body.assets, assetCount: body.assets.length }),
    ...(body.errorMessage === undefined ? {} : { errorMessage: safeError(body.errorMessage) })
  };
}

function summarizeAspectDrift(assets: NonNullable<CompleteMediaProcessingJobInput["assets"]>): Record<string, unknown> {
  const drifts = assets.map((asset) => asset.aspectDrift).filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const maxDrift = drifts.length === 0 ? 0 : Math.max(...drifts.map((value) => Math.abs(value)));
  return {
    checked: drifts.length,
    maxDrift,
    status: maxDrift > 0.02 ? "warning" : "ok"
  };
}

function mediaJobWarnings(job: MediaProcessingJobRecord): string[] {
  const warnings: string[] = [];
  const aspectSummary = asRecord(job.output.aspectSummary);
  const aspectStatus = readString(aspectSummary.status);
  if (aspectStatus === "warning") warnings.push(`aspect drift ${String(aspectSummary.maxDrift ?? "unknown")}`);
  const rawWarnings = job.output.warnings;
  if (Array.isArray(rawWarnings)) warnings.push(...rawWarnings.filter((entry): entry is string => typeof entry === "string"));
  if (job.errorMessage) warnings.push(job.errorMessage);
  return warnings;
}

function publicReadiness(readiness: ItemMediaReadiness): Omit<ItemMediaReadiness, "jobs"> {
  const { jobs: _jobs, ...publicValue } = readiness;
  return publicValue;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function mediaProcessingSourceLimit(env: EnvWithMediaProcessing): number {
  const raw = env.TELEGRAM_MEDIA_MAX_ASSETS ?? env.MEDIA_MAX_ASSETS ?? "10";
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(parsed, 10)) : 10;
}

function mediaCandidateUrls(urls: string[]): string[] {
  return uniqueHttpUrls(urls).filter((url) => isLikelyExternalMediaSource(url));
}

export function inspectMediaDebugUrl(sourceUrl: string): Record<string, unknown> {
  const candidates = uniqueHttpUrls([sourceUrl, ...fallbackSocialUrlCandidates(sourceUrl)]);
  const platform = detectMediaPlatform(sourceUrl);
  const providerOrder = platform === "instagram"
    ? ["direct", "gallery_dl", "instaloader", "yt_dlp", "external"]
    : platform === "x"
      ? ["direct", "gallery_dl", "yt_dlp", "external"]
      : ["direct", "yt_dlp", "external"];
  return {
    sourceUrl,
    supported: isLikelyExternalMediaSource(sourceUrl),
    platform,
    candidates,
    directMedia: isDirectMediaUrl(sourceUrl),
    providerOrder,
    providerAttemptsPreview: providerOrder.map((provider) => ({ provider, status: provider === "direct" && !isDirectMediaUrl(sourceUrl) ? "no_direct_extension" : "not_run" })),
    strategy: ["direct", "gallery_dl", "instaloader", "yt_dlp_progressive_mp4", "yt_dlp_split_merge", "optional_external_endpoint"],
    qualityPolicy: { profile: "telegram_review_optimized", preserveAspectRatio: true, noCrop: true, noSquareConversion: true, maxSide: 1920 },
    mediaGroupLimit: 10
  };
}

function detectMediaPlatform(url: string): "x" | "instagram" | "tiktok" | "youtube" | "direct" | "other" {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    if (isDirectMediaUrl(url)) return "direct";
    if (host === "x.com" || host === "twitter.com" || host.endsWith(".x.com") || host.endsWith(".twitter.com")) return "x";
    if (host === "instagram.com" || host.endsWith(".instagram.com")) return "instagram";
    if (host === "tiktok.com" || host.endsWith(".tiktok.com")) return "tiktok";
    if (host === "youtube.com" || host.endsWith(".youtube.com") || host === "youtu.be") return "youtube";
    return "other";
  } catch {
    return "other";
  }
}

function isLikelyExternalMediaSource(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    const path = parsed.pathname.toLowerCase();
    if (/\.(jpg|jpeg|png|webp|gif|mp4|m4v|mov|webm)(\?.*)?$/.test(path)) return true;
    return host === "x.com"
      || host.endsWith(".x.com")
      || host === "twitter.com"
      || host.endsWith(".twitter.com")
      || host === "instagram.com"
      || host.endsWith(".instagram.com")
      || host === "tiktok.com"
      || host.endsWith(".tiktok.com")
      || host === "youtube.com"
      || host.endsWith(".youtube.com")
      || host === "youtu.be";
  } catch {
    return false;
  }
}

function isDirectMediaUrl(url: string): boolean {
  try {
    const path = new URL(url).pathname.toLowerCase();
    return /\.(jpg|jpeg|png|webp|gif|mp4|m4v|mov|webm)$/.test(path);
  } catch {
    return false;
  }
}

function fallbackSocialUrlCandidates(url: string): string[] {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    if (host === "x.com" || host === "twitter.com") {
      const path = `${parsed.pathname}${parsed.search}`;
      return [`https://vxtwitter.com${path}`, `https://fxtwitter.com${path}`];
    }
    return [];
  } catch {
    return [];
  }
}

function uniqueHttpUrls(urls: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const url of urls) {
    const trimmed = url.trim();
    if (!/^https?:\/\//i.test(trimmed) || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

function safeError(value: string): string {
  return value.replace(/[0-9]{6,}:[A-Za-z0-9_-]+/g, "[redacted-token]").slice(0, 500);
}

function stableHash(value: string): string {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(index);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
