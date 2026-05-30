import { MediaAssetsRepository, MediaProcessingJobsRepository, type MediaAssetStatus, type UpdateTelegramMediaInput } from "@curator/db";
import { completeMediaProcessingJob, type CompleteMediaProcessingJobInput } from "../operations/media-processing";
import { jsonResponse } from "../http/json";
import { verifyInternalRequest } from "../security/internal-auth";
import { badRequest, methodNotAllowed, parseJsonBody, serverError, unauthorized } from "./response";
import type { Env } from "../types";

type MediaJobCompleteBody = {
  jobId?: unknown;
  assetId?: unknown;
  mediaAssetId?: unknown;
  itemId?: unknown;
  status?: unknown;
  errorMessage?: unknown;
  telegramFileId?: unknown;
  telegramFileUniqueId?: unknown;
  telegramFileType?: unknown;
  telegramMimeType?: unknown;
  telegramFileSize?: unknown;
  sizeBytes?: unknown;
  mimeType?: unknown;
  width?: unknown;
  height?: unknown;
  durationSeconds?: unknown;
  publicUrl?: unknown;
  storageKey?: unknown;
  assets?: unknown;
  result?: unknown;
};

type CompletedAssetBody = Omit<MediaJobCompleteBody, "assets"> & { id?: unknown; kind?: unknown; sourceUrl?: unknown };

export async function handleInternalMediaJobs(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === "/internal/media/jobs" && request.method === "GET") return handleList(request, env);
  if (url.pathname === "/internal/media/jobs/complete" && request.method === "POST") return handleComplete(request, env);
  return methodNotAllowed(url.pathname.endsWith("/complete") ? ["POST"] : ["GET"], request);
}

async function handleList(request: Request, env: Env): Promise<Response> {
  const auth = verifyInternalRequest(request, env);
  if (!auth.ok) return unauthorized(auth.error, "Internal API authorization failed.", request);
  const url = new URL(request.url);
  const repository = new MediaProcessingJobsRepository(env.DB);
  const jobs = await repository.listRecent(readLimit(url.searchParams.get("limit")), readStatus(url.searchParams.get("status")));
  return jsonResponse({ ok: true, jobs: jobs.map((job) => ({
    jobId: job.id,
    itemId: job.itemId,
    mediaAssetId: job.mediaAssetId,
    sourceUrl: job.sourceUrl,
    kind: job.kind,
    processor: job.processor,
    status: job.status,
    workflowRunId: job.workflowRunId,
    errorMessage: job.errorMessage,
    output: job.output,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt
  })) });
}

async function handleComplete(request: Request, env: Env): Promise<Response> {
  const auth = verifyInternalRequest(request, env);
  if (!auth.ok) return unauthorized(auth.error, "Internal API authorization failed.", request);
  const parsed = await parseJsonBody<MediaJobCompleteBody>(request);
  if (!parsed.ok) return parsed.response;

  try {
    const body = parsed.value;
    const jobId = readString(body.jobId);
    const callbackStatus = readString(body.status);
    if (jobId && (Array.isArray(body.assets) || callbackStatus === "ready" || callbackStatus === "failed" || callbackStatus === "skipped" || callbackStatus === "processing")) {
      const normalizedCallbackStatus: CompleteMediaProcessingJobInput["status"] = callbackStatus === "processing" || callbackStatus === "ready" || callbackStatus === "failed" || callbackStatus === "skipped"
        ? callbackStatus
        : normalizeStatus(body.status, body.telegramFileId, body.assets) === "ready" ? "ready" : "failed";
      const callbackInput: CompleteMediaProcessingJobInput = {
        jobId,
        status: normalizedCallbackStatus,
        raw: asRecord(body.result)
      };
      const callbackErrorMessage = readString(body.errorMessage);
      if (callbackErrorMessage !== undefined) callbackInput.errorMessage = callbackErrorMessage;
      if (Array.isArray(body.assets)) callbackInput.assets = body.assets as NonNullable<CompleteMediaProcessingJobInput["assets"]>;
      const result = await completeMediaProcessingJob(env, callbackInput);
      return jsonResponse(result, { status: result.ok ? 200 : 400 });
    }

    const mediaAssetsRepository = new MediaAssetsRepository(env.DB);
    const jobsRepository = new MediaProcessingJobsRepository(env.DB);
    const job = jobId ? await jobsRepository.findById(jobId) : null;
    const assetId = readString(body.assetId) ?? readString(body.mediaAssetId) ?? job?.mediaAssetId;
    if (!assetId) return badRequest("missing_asset_id", "assetId or mediaAssetId is required.", request);

    const existing = await mediaAssetsRepository.findById(assetId);
    if (!existing) return badRequest("media_asset_not_found", "Media asset was not found.", request);

    const status = normalizeStatus(body.status, body.telegramFileId, body.assets);
    const primaryAsset = firstCompletedAsset(body);
    const updateInput: UpdateTelegramMediaInput = { id: assetId, status };
    const errorMessage = readString(body.errorMessage);
    if (errorMessage !== undefined) updateInput.errorMessage = errorMessage;
    const telegramFileId = readString(primaryAsset.telegramFileId);
    if (telegramFileId !== undefined) updateInput.telegramFileId = telegramFileId;
    const telegramFileUniqueId = readString(primaryAsset.telegramFileUniqueId);
    if (telegramFileUniqueId !== undefined) updateInput.telegramFileUniqueId = telegramFileUniqueId;
    const telegramFileType = readString(primaryAsset.telegramFileType);
    if (telegramFileType !== undefined) updateInput.telegramFileType = telegramFileType;
    const telegramMimeType = readString(primaryAsset.telegramMimeType);
    if (telegramMimeType !== undefined) updateInput.telegramMimeType = telegramMimeType;
    const telegramFileSize = readNumber(primaryAsset.telegramFileSize);
    if (telegramFileSize !== undefined) updateInput.telegramFileSize = telegramFileSize;
    const sizeBytes = readNumber(primaryAsset.sizeBytes);
    if (sizeBytes !== undefined) updateInput.sizeBytes = sizeBytes;
    const mimeType = readString(primaryAsset.mimeType);
    if (mimeType !== undefined) updateInput.mimeType = mimeType;
    const width = readNumber(primaryAsset.width);
    if (width !== undefined) updateInput.width = width;
    const height = readNumber(primaryAsset.height);
    if (height !== undefined) updateInput.height = height;
    const durationSeconds = readNumber(primaryAsset.durationSeconds);
    if (durationSeconds !== undefined) updateInput.durationSeconds = durationSeconds;
    const publicUrl = readString(primaryAsset.publicUrl);
    if (publicUrl !== undefined) updateInput.publicUrl = publicUrl;
    const storageKey = readString(primaryAsset.storageKey);
    if (storageKey !== undefined) updateInput.storageKey = storageKey;
    await mediaAssetsRepository.updateTelegramMetadata(updateInput);

    if (job) {
      if (status === "ready") await jobsRepository.markReady(job.id, asRecord(body.result));
      else if (status === "processing") await jobsRepository.markProcessing(job.id);
      else await jobsRepository.markFailed(job.id, readString(body.errorMessage) ?? `Media processor returned ${status}.`, asRecord(body.result));
    }

    return jsonResponse({ ok: true, jobId: job?.id, assetId, itemId: existing.itemId, status });
  } catch (error) {
    return serverError("media_job_complete_failed", error instanceof Error ? error.message : "Media job completion failed.", request);
  }
}

function firstCompletedAsset(body: MediaJobCompleteBody): CompletedAssetBody {
  const assets = Array.isArray(body.assets) ? body.assets : [];
  const first = assets.find((entry): entry is CompletedAssetBody => typeof entry === "object" && entry !== null && !Array.isArray(entry));
  return first ?? body;
}

function normalizeStatus(value: unknown, telegramFileId: unknown, assets: unknown): MediaAssetStatus {
  if (value === "failed" || value === "skipped" || value === "processing" || value === "pending" || value === "ready") return value;
  const first = Array.isArray(assets) ? assets.find((entry) => typeof entry === "object" && entry !== null && !Array.isArray(entry)) as Record<string, unknown> | undefined : undefined;
  return readString(telegramFileId) || readString(first?.telegramFileId) ? "ready" : "failed";
}

function readLimit(value: string | null): number {
  const parsed = value === null ? NaN : Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 100) : 25;
}

function readStatus(value: string | null): "pending" | "dispatching" | "dispatched" | "processing" | "ready" | "failed" | "skipped" | undefined {
  return value === "pending" || value === "dispatching" || value === "dispatched" || value === "processing" || value === "ready" || value === "failed" || value === "skipped" ? value : undefined;
}

function readString(value: unknown): string | undefined { return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined; }
function readNumber(value: unknown): number | undefined { return typeof value === "number" && Number.isFinite(value) ? value : undefined; }
function asRecord(value: unknown): Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
