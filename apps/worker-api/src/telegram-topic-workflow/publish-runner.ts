import { MediaAssetsRepository, MediaProcessingJobsRepository, TelegramGeneratedOutputsRepository, TelegramPublishQueueRepository, TelegramRoutesRepository, type TelegramPublishQueueRecord } from "@curator/db";
import { RealTelegramClient, redactTelegramApiError, validateTelegramPublishMedia, type ParsedTelegramMedia, type TelegramClient } from "@curator/telegram";
import type { Env } from "../types";
import { applyRouteOutputSignature } from "./channel-signature";
import { refreshTelegramReviewMessageState } from "./review-message-state";

export type TelegramQueuePublishResult = {
  ok: boolean;
  queueId: string;
  generatedOutputId: string;
  status: "published" | "failed" | "skipped";
  message: string;
  finalMessageId?: string;
};

export async function publishTelegramQueueItem(input: {
  env: Env;
  queueItem: TelegramPublishQueueRecord;
  callbackClient?: TelegramClient | undefined;
}): Promise<TelegramQueuePublishResult> {
  const generatedOutputsRepository = new TelegramGeneratedOutputsRepository(input.env.DB);
  const publishQueueRepository = new TelegramPublishQueueRepository(input.env.DB);
  const routesRepository = new TelegramRoutesRepository(input.env.DB);
  const mediaAssetsRepository = new MediaAssetsRepository(input.env.DB);
  const mediaJobsRepository = new MediaProcessingJobsRepository(input.env.DB);
  const generatedOutput = await generatedOutputsRepository.findById(input.queueItem.generatedOutputId);

  if (!generatedOutput) {
    await publishQueueRepository.markFailed(input.queueItem.id, "Generated output is missing.");
    return { ok: false, queueId: input.queueItem.id, generatedOutputId: input.queueItem.generatedOutputId, status: "failed", message: "Generated output is missing." };
  }

  const routeOutput = await routesRepository.findOutputById(generatedOutput.routeOutputId);
  if (!routeOutput) {
    await generatedOutputsRepository.updateStatus(generatedOutput.id, "failed", "Route output is missing.");
    await publishQueueRepository.markFailed(input.queueItem.id, "Route output is missing.");
    await refreshTelegramReviewMessageState({ env: input.env, generatedOutputId: generatedOutput.id, telegramClient: input.callbackClient });
    return { ok: false, queueId: input.queueItem.id, generatedOutputId: generatedOutput.id, status: "failed", message: "Route output is missing." };
  }

  if (!routeOutput.publishEnabled) {
    await generatedOutputsRepository.updateStatus(generatedOutput.id, "failed", "Publishing is disabled for this route output.");
    await publishQueueRepository.markFailed(input.queueItem.id, "Publishing is disabled for this route output.");
    await refreshTelegramReviewMessageState({ env: input.env, generatedOutputId: generatedOutput.id, telegramClient: input.callbackClient });
    return { ok: false, queueId: input.queueItem.id, generatedOutputId: generatedOutput.id, status: "failed", message: "Publishing is disabled for this route output." };
  }

  const botToken = input.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!botToken) {
    await generatedOutputsRepository.updateStatus(generatedOutput.id, "failed", "Telegram bot token is not configured.");
    await publishQueueRepository.markFailed(input.queueItem.id, "Telegram bot token is not configured.");
    await refreshTelegramReviewMessageState({ env: input.env, generatedOutputId: generatedOutput.id, telegramClient: input.callbackClient });
    return { ok: false, queueId: input.queueItem.id, generatedOutputId: generatedOutput.id, status: "failed", message: "Telegram bot token is not configured." };
  }

  const mediaJobs = await mediaJobsRepository.listByItemId(generatedOutput.itemId);
  const unfinishedMediaJobs = mediaJobs.filter((job) => job.status === "pending" || job.status === "dispatching" || job.status === "dispatched" || job.status === "processing");
  if (unfinishedMediaJobs.length > 0) {
    await refreshTelegramReviewMessageState({ env: input.env, generatedOutputId: generatedOutput.id, telegramClient: input.callbackClient });
    return {
      ok: true,
      queueId: input.queueItem.id,
      generatedOutputId: generatedOutput.id,
      status: "skipped",
      message: `Media is still processing (${unfinishedMediaJobs.length} job(s)). The output remains queued.`
    };
  }

  const failedMediaJobs = mediaJobs.filter((job) => job.status === "failed");
  if (failedMediaJobs.length > 0) {
    const message = failedMediaJobs[0]?.errorMessage ?? "External media processing failed.";
    await generatedOutputsRepository.updateStatus(generatedOutput.id, "failed", message);
    await publishQueueRepository.markFailed(input.queueItem.id, message);
    await refreshTelegramReviewMessageState({ env: input.env, generatedOutputId: generatedOutput.id, telegramClient: input.callbackClient });
    return { ok: false, queueId: input.queueItem.id, generatedOutputId: generatedOutput.id, status: "failed", message };
  }

  const mediaReadiness = await mediaForItem(mediaAssetsRepository, generatedOutput.itemId);
  if (!mediaReadiness.ok) {
    if (mediaReadiness.retryable) {
      await refreshTelegramReviewMessageState({ env: input.env, generatedOutputId: generatedOutput.id, telegramClient: input.callbackClient });
      return { ok: true, queueId: input.queueItem.id, generatedOutputId: generatedOutput.id, status: "skipped", message: mediaReadiness.message };
    }
    await generatedOutputsRepository.updateStatus(generatedOutput.id, "failed", mediaReadiness.message);
    await publishQueueRepository.markFailed(input.queueItem.id, mediaReadiness.message);
    await refreshTelegramReviewMessageState({ env: input.env, generatedOutputId: generatedOutput.id, telegramClient: input.callbackClient });
    return { ok: false, queueId: input.queueItem.id, generatedOutputId: generatedOutput.id, status: "failed", message: mediaReadiness.message };
  }

  const media = mediaReadiness.media;
  const mediaValidation = validateTelegramPublishMedia(media);
  if (!mediaValidation.ok) {
    await generatedOutputsRepository.updateStatus(generatedOutput.id, "failed", mediaValidation.errorMessage);
    await publishQueueRepository.markFailed(input.queueItem.id, mediaValidation.errorMessage);
    await refreshTelegramReviewMessageState({ env: input.env, generatedOutputId: generatedOutput.id, telegramClient: input.callbackClient });
    return { ok: false, queueId: input.queueItem.id, generatedOutputId: generatedOutput.id, status: "failed", message: mediaValidation.errorMessage };
  }

  await generatedOutputsRepository.updateStatus(generatedOutput.id, "publishing");
  const finalCaption = applyRouteOutputSignature(generatedOutput.output.caption, routeOutput);

  await publishQueueRepository.markPublishing(input.queueItem.id);
  await refreshTelegramReviewMessageState({ env: input.env, generatedOutputId: generatedOutput.id, telegramClient: input.callbackClient });

  try {
    const publishClient = new RealTelegramClient({ botToken });
    const sent = await publishClient.publishFinalMessage({
      chatId: routeOutput.finalChatId,
      ...(routeOutput.finalThreadId === undefined ? {} : { messageThreadId: routeOutput.finalThreadId }),
      text: finalCaption,
      ...(media.length === 0 ? {} : { media })
    });
    await publishQueueRepository.markPublished(input.queueItem.id, sent.messageId);
    await generatedOutputsRepository.updateStatus(generatedOutput.id, "published");
    await refreshTelegramReviewMessageState({ env: input.env, generatedOutputId: generatedOutput.id, telegramClient: input.callbackClient });
    return { ok: true, queueId: input.queueItem.id, generatedOutputId: generatedOutput.id, status: "published", message: "Published to Telegram.", finalMessageId: sent.messageId };
  } catch (error) {
    const message = redactPublishError(error);
    await publishQueueRepository.markFailed(input.queueItem.id, message);
    await generatedOutputsRepository.updateStatus(generatedOutput.id, "failed", message);
    await refreshTelegramReviewMessageState({ env: input.env, generatedOutputId: generatedOutput.id, telegramClient: input.callbackClient });
    return { ok: false, queueId: input.queueItem.id, generatedOutputId: generatedOutput.id, status: "failed", message };
  }
}

async function mediaForItem(repository: MediaAssetsRepository, itemId: string): Promise<{ ok: true; media: ParsedTelegramMedia[] } | { ok: false; message: string; retryable: boolean }> {
  const assets = await repository.findByItemId(itemId);
  const externalAssets = assets.filter((asset) => asset.sourceUrl.startsWith("http://") || asset.sourceUrl.startsWith("https://"));
  const pendingExternal = externalAssets.filter((asset) => asset.telegramFileId === undefined && (asset.status === "pending" || asset.status === "processing"));
  if (pendingExternal.length > 0) {
    return { ok: false, message: `Media processing is still pending for ${pendingExternal.length} external asset(s).`, retryable: true };
  }
  const failedExternal = externalAssets.filter((asset) => asset.status === "failed" && asset.telegramFileId === undefined);
  if (failedExternal.length > 0) {
    return { ok: false, message: failedExternal[0]?.errorMessage ?? "External media processing failed.", retryable: false };
  }

  const media = assets
    .filter((asset) => asset.telegramFileId !== undefined && asset.telegramFileType !== undefined)
    .map((asset) => ({
      kind: toParsedMediaKind(asset.telegramFileType),
      fileId: asset.telegramFileId!,
      ...(asset.telegramFileUniqueId === undefined ? {} : { fileUniqueId: asset.telegramFileUniqueId }),
      ...(asset.telegramMediaGroupId === undefined ? {} : { mediaGroupId: asset.telegramMediaGroupId }),
      ...(asset.telegramMimeType === undefined ? {} : { mimeType: asset.telegramMimeType }),
      ...(asset.telegramFileSize === undefined ? {} : { fileSize: asset.telegramFileSize }),
      ...(asset.width === undefined ? {} : { width: asset.width }),
      ...(asset.height === undefined ? {} : { height: asset.height }),
      ...(asset.durationSeconds === undefined ? {} : { durationSeconds: asset.durationSeconds })
    }));
  return { ok: true, media };
}

function toParsedMediaKind(value: string | undefined): ParsedTelegramMedia["kind"] {
  if (value === "photo") return "photo";
  if (value === "video") return "video";
  if (value === "animation") return "animation";
  return "document";
}

function redactPublishError(error: unknown): string {
  if (error instanceof Error) return redactTelegramApiError(error.message);
  return "Telegram publish failed.";
}
