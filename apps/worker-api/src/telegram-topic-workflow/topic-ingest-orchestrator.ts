import { IngestGateService, ItemsRepository, MediaAssetsRepository, SourcesRepository, TelegramGeneratedOutputsRepository, TelegramReviewMessagesRepository, type TelegramRouteOutputRecord, type TelegramRouteRecord } from "@curator/db";
import type { NormalizedMedia, NormalizedPost } from "@curator/core";
import { buildTelegramOutputReviewDraft, MockTelegramClient, RealTelegramClient, type ParsedManualTelegramMessage, type ParsedTelegramMedia, type TelegramClient } from "@curator/telegram";
import type { Env } from "../types";
import { generateLocalizedTelegramOutput } from "./output-orchestrator";
import { resolveExternalSourceText, type SourceContentResolution } from "./source-content-resolver";
import { evaluateMediaReadinessAndMaybeSendReview, maybeDispatchExternalMediaProcessing, type MediaProcessingDispatchResult } from "./media-processing-orchestrator";
import { applyRouteOutputSignature } from "./channel-signature";

export type TelegramTopicIngestInput = {
  env: Env;
  parsed: ParsedManualTelegramMessage;
  route: TelegramRouteRecord;
  outputs: TelegramRouteOutputRecord[];
  telegramClient?: TelegramClient;
};

export type TelegramTopicIngestResult = {
  ok: true;
  routed: true;
  routeId: string;
  category: string;
  itemId: string;
  generatedOutputCount: number;
  reviewMessageCount: number;
  mediaMetadataCount: number;
  finalPublishingEnabled: false;
};

export async function handleTelegramTopicIngest(input: TelegramTopicIngestInput): Promise<TelegramTopicIngestResult> {
  const sourcesRepository = new SourcesRepository(input.env.DB);
  const ingestGateService = new IngestGateService(input.env.DB);
  const itemsRepository = new ItemsRepository(input.env.DB);
  const mediaAssetsRepository = new MediaAssetsRepository(input.env.DB);
  const generatedOutputsRepository = new TelegramGeneratedOutputsRepository(input.env.DB);
  const reviewMessagesRepository = new TelegramReviewMessagesRepository(input.env.DB);
  const telegramClient = input.telegramClient ?? createTelegramReviewClient(input.env);

  const sourcePostId = createTopicSourcePostId(input.parsed);
  const canonicalUrl = input.parsed.urls[0] ?? `telegram://topic/${input.parsed.chatId}/${input.parsed.threadId ?? "none"}/${input.parsed.messageId}`;
  const sourceAttributionText = "";
  const externalResolution = await resolveExternalSourceText(input.env, input.parsed.urls);
  const post = createTopicNormalizedPost(input.parsed, sourcePostId, canonicalUrl, input.route, externalResolution);

  await sourcesRepository.ensureManualTelegramSource();
  const gateResult = await ingestGateService.process({ sourceId: "manual_telegram", post });

  if (gateResult.outcome !== "queued") {
    return {
      ok: true,
      routed: true,
      routeId: input.route.id,
      category: input.route.category,
      itemId: gateResult.outcome === "duplicate" ? gateResult.existingItemId ?? `duplicate_${sourcePostId}` : `invalid_${sourcePostId}`,
      generatedOutputCount: 0,
      reviewMessageCount: 0,
      mediaMetadataCount: input.parsed.media.length,
      finalPublishingEnabled: false
    };
  }

  const item = gateResult.item;
  await storeTelegramMediaMetadata(mediaAssetsRepository, item.id, input.parsed.media);
  const mediaDispatch = await maybeDispatchExternalMediaProcessing({
    env: input.env,
    itemId: item.id,
    sourceUrls: input.parsed.urls,
    requestedBy: `telegram:${input.parsed.chatId}:${input.parsed.threadId ?? "none"}:${input.parsed.messageId}`
  });

  let generatedOutputCount = 0;
  let reviewMessageCount = 0;

  for (const routeOutput of input.outputs) {
    try {
      const localized = await generateLocalizedTelegramOutput({
        env: input.env,
        itemId: item.id,
        route: input.route,
        routeOutput,
        post,
        sourceAttributionText
      });
      const localizedOutput = localized.output;
      const reviewCaption = applyRouteOutputSignature(localizedOutput.caption, routeOutput);
      const generatedOutput = await generatedOutputsRepository.save({
        itemId: item.id,
        routeId: input.route.id,
        routeOutputId: routeOutput.id,
        language: routeOutput.language,
        status: "ready_for_review",
        promptProfile: input.route.promptProfile,
        model: localized.model,
        output: localizedOutput,
        inputTokens: localized.inputTokens ?? estimateTokens(post.text ?? canonicalUrl),
        outputTokens: localized.outputTokens ?? estimateTokens(localizedOutput.caption)
      });
      generatedOutputCount += 1;

      const shouldWaitForExternalMediaReview = input.parsed.media.length === 0 && mediaDispatch.createdJobs.length > 0;

      if (!shouldWaitForExternalMediaReview) {
        const sourceButtonUrl = createReviewSourceButtonUrl(canonicalUrl);
        const draft = buildTelegramOutputReviewDraft({
          generatedOutputId: generatedOutput.id,
          category: input.route.category,
          language: routeOutput.language,
          itemId: item.id,
          sourceUrl: canonicalUrl,
          originalExcerpt: createOriginalExcerpt(input.parsed.text) ?? "",
          caption: reviewCaption,
          ...(localizedOutput.summary === undefined ? {} : { summary: localizedOutput.summary }),
          riskFlags: localizedOutput.riskFlags,
          status: generatedOutput.status,
          callbackToken: generatedOutput.id,
          scheduleSummary: createScheduleSummary(routeOutput),
          mediaSummary: createMediaSummary(input.parsed.media, mediaDispatch),
          hasPreviewMedia: input.parsed.media.length > 0,
          publishMode: routeOutput.publishMode,
          timezone: routeOutput.timezone,
          allowedPublishWindows: routeOutput.allowedPublishWindows,
          minimumGapMinutes: routeOutput.minimumGapMinutes,
          ...(sourceButtonUrl === undefined ? {} : { sourceButtonUrl })
        });
        const sent = await telegramClient.sendReviewMessage({
          chatId: routeOutput.reviewChatId,
          messageThreadId: routeOutput.reviewThreadId,
          text: draft.text,
          replyMarkup: draft.reply_markup,
          media: input.parsed.media,
          mediaPreviewCaption: reviewCaption
        });
        await reviewMessagesRepository.create({
          generatedOutputId: generatedOutput.id,
          itemId: item.id,
          routeId: input.route.id,
          routeOutputId: routeOutput.id,
          language: routeOutput.language,
          chatId: sent.chatId,
          threadId: routeOutput.reviewThreadId,
          messageId: sent.messageId,
          status: "sent"
        });
        reviewMessageCount += 1;
      }
    } catch (error) {
      const fallbackCaption = buildFallbackCaptionForFailedGeneration({ post, canonicalUrl, error });
      const signedFallbackCaption = applyRouteOutputSignature(fallbackCaption, routeOutput);
      const generatedOutput = await generatedOutputsRepository.save({
        itemId: item.id,
        routeId: input.route.id,
        routeOutputId: routeOutput.id,
        language: routeOutput.language,
        status: "ready_for_review",
        promptProfile: input.route.promptProfile,
        model: input.env.AI_MODEL ?? "unknown",
        output: {
          language: routeOutput.language,
          caption: fallbackCaption,
          summary: "Fallback caption was generated from source text for review.",
          hashtags: [],
          riskFlags: ["ai_fallback", "needs_review"],
          sourceAttributionText
        },
        errorMessage: describeTopicOutputError(error)
      });

      generatedOutputCount += 1;

      const shouldWaitForExternalMediaReview = input.parsed.media.length === 0 && mediaDispatch.createdJobs.length > 0;
      if (!shouldWaitForExternalMediaReview) {
        const sourceButtonUrl = createReviewSourceButtonUrl(canonicalUrl);
        const draft = buildTelegramOutputReviewDraft({
          generatedOutputId: generatedOutput.id,
          category: input.route.category,
          language: routeOutput.language,
          itemId: item.id,
          sourceUrl: canonicalUrl,
          originalExcerpt: createOriginalExcerpt(input.parsed.text) ?? "",
          caption: signedFallbackCaption,
          summary: "Fallback caption was generated from source text for review.",
          riskFlags: ["ai_fallback", "needs_review"],
          status: generatedOutput.status,
          callbackToken: generatedOutput.id,
          scheduleSummary: createScheduleSummary(routeOutput),
          mediaSummary: createMediaSummary(input.parsed.media, mediaDispatch),
          hasPreviewMedia: input.parsed.media.length > 0,
          publishMode: routeOutput.publishMode,
          timezone: routeOutput.timezone,
          allowedPublishWindows: routeOutput.allowedPublishWindows,
          minimumGapMinutes: routeOutput.minimumGapMinutes,
          ...(sourceButtonUrl === undefined ? {} : { sourceButtonUrl })
        });

        const sent = await telegramClient.sendReviewMessage({
          chatId: routeOutput.reviewChatId,
          messageThreadId: routeOutput.reviewThreadId,
          text: draft.text,
          replyMarkup: draft.reply_markup,
          media: input.parsed.media,
          mediaPreviewCaption: signedFallbackCaption
        });

        await reviewMessagesRepository.create({
          generatedOutputId: generatedOutput.id,
          itemId: item.id,
          routeId: input.route.id,
          routeOutputId: routeOutput.id,
          language: routeOutput.language,
          chatId: sent.chatId,
          threadId: routeOutput.reviewThreadId,
          messageId: sent.messageId,
          status: "sent"
        });
        reviewMessageCount += 1;
      }
    }
  }

  if (input.parsed.media.length === 0 && mediaDispatch.createdJobs.length > 0) {
    await evaluateMediaReadinessAndMaybeSendReview(input.env, item.id, canonicalUrl);
  }

  await itemsRepository.updateStatus(item.id, "sent_to_review");

  return {
    ok: true,
    routed: true,
    routeId: input.route.id,
    category: input.route.category,
    itemId: item.id,
    generatedOutputCount,
    reviewMessageCount,
    mediaMetadataCount: input.parsed.media.length,
    finalPublishingEnabled: false
  };
}

function buildFallbackCaptionForFailedGeneration(input: {
  post: NormalizedPost;
  canonicalUrl: string;
  error: unknown;
}): string {
  const sourceText = input.post.text?.trim();
  const reason = describeTopicOutputError(input.error);
  const parts = [
    sourceText && sourceText.length > 0
      ? sourceText
      : "متن پست از لینک social قابل استخراج نبود.",
    "",
    "",
    "",
    "",
    ""
  ];

  return parts.join("\n").trim();
}

function describeTopicOutputError(error: unknown): string {
  if (error instanceof Error) {
    const cause = (error as Error & { cause?: unknown }).cause;
    if (cause instanceof Error && cause.message.trim().length > 0) {
      return `${error.message}; cause: ${cause.name}: ${cause.message}`;
    }
    return error.message;
  }
  return "Localized Telegram output generation failed.";
}

function createReviewSourceButtonUrl(canonicalUrl: string): string | undefined {
  if (canonicalUrl.startsWith("http://") || canonicalUrl.startsWith("https://") || canonicalUrl.startsWith("tg://")) {
    return canonicalUrl;
  }

  const topicMatch = canonicalUrl.match(/^telegram:\/\/topic\/(-?\d+)\/(\d+|none)\/(\d+)$/);
  if (!topicMatch) return undefined;

  const chatId = topicMatch[1]!;
  const threadId = topicMatch[2]!;
  const messageId = topicMatch[3]!;
  if (threadId === "none") return undefined;

  const privateChatId = chatId.startsWith("-100") ? chatId.slice(4) : chatId.replace(/^-/, "");
  return `https://t.me/c/${privateChatId}/${threadId}/${messageId}`;
}

function createScheduleSummary(routeOutput: TelegramRouteOutputRecord): string {
  const windows = routeOutput.allowedPublishWindows.length === 0 ? "anytime" : routeOutput.allowedPublishWindows.join(", ");
  return `${routeOutput.publishMode}; ${routeOutput.timezone}; window ${windows}; gap ${routeOutput.minimumGapMinutes}m; max ${routeOutput.maxPostsPerHour}/hour, ${routeOutput.maxPostsPerDay}/day`;
}

function createMediaSummary(media: ParsedTelegramMedia[], dispatch: MediaProcessingDispatchResult): string {
  const parts: string[] = [];
  if (media.length > 0) {
    const counts = media.reduce<Record<string, number>>((accumulator, entry) => {
      accumulator[entry.kind] = (accumulator[entry.kind] ?? 0) + 1;
      return accumulator;
    }, {});
    parts.push(Object.entries(counts).map(([kind, count]) => `${count} ${kind}`).join(", "));
  }
  if (dispatch.enabled) {
    parts.push(`external processor: ${dispatch.createdJobs.length} jobs, ${dispatch.dispatchedJobs.length} dispatched`);
    if (dispatch.warnings.length > 0) parts.push(`warnings: ${dispatch.warnings.join("; ")}`);
  }
  return parts.length === 0 ? "none" : parts.join(" | ");
}

function createTelegramReviewClient(env: Env): TelegramClient {
  const botToken = env.TELEGRAM_BOT_TOKEN?.trim();
  if (env.TELEGRAM_REAL_REVIEW_ENABLED === "true" && botToken) {
    return new RealTelegramClient({ botToken });
  }
  return new MockTelegramClient();
}

function createTopicNormalizedPost(parsed: ParsedManualTelegramMessage, sourcePostId: string, canonicalUrl: string, route: TelegramRouteRecord, externalResolution?: SourceContentResolution): NormalizedPost {
  return {
    provider: "mock_social_provider",
    platform: "manual",
    sourceType: parsed.urls.length > 0 ? "web_url" : "manual",
    sourcePostId,
    canonicalUrl,
    publishedAt: new Date((parsed.message.date ?? Math.floor(Date.now() / 1000)) * 1000).toISOString(),
    authorHandle: parsed.message.from?.username ?? `telegram_user_${parsed.reviewerId}`,
    text: mergeSourceText(parsed.text, externalResolution?.text, parsed.urls),
    links: parsed.urls,
    media: parsed.media.map(toNormalizedMedia),
    rawPayload: {
      source: "telegram_topic_ingest",
      updateId: parsed.updateId,
      chatId: parsed.chatId,
      threadId: parsed.threadId,
      messageId: parsed.messageId,
      routeId: route.id,
      category: route.category,
      promptProfile: route.promptProfile,
      externalLinkMetadata: {
        resolvedTextLength: externalResolution?.text?.length ?? 0,
        warning: externalResolution?.warning ?? ""
      }
    }
  };
}

function mergeSourceText(telegramText: string, externalText: string | undefined, sourceUrls: string[]): string {
  const resolvedExternalText = externalText?.trim();

  const cleanedTelegramText = resolvedExternalText === undefined || resolvedExternalText.length === 0
    ? telegramText.trim()
    : removeOnlySourceUrls(telegramText, sourceUrls).trim();

  const parts = [cleanedTelegramText, resolvedExternalText].filter((value): value is string => value !== undefined && value.length > 0);
  return Array.from(new Set(parts)).join("\n\n");
}

function removeOnlySourceUrls(value: string, sourceUrls: string[]): string {
  const candidates = sourceUrls.flatMap(sourceUrlCandidates);
  if (candidates.length === 0) return value;

  return value
    .split("\n")
    .map((line) => removeCandidatesFromLine(line, candidates))
    .filter((line) => line.trim().length > 0)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function removeCandidatesFromLine(line: string, candidates: string[]): string {
  let next = line;
  for (const candidate of candidates) {
    if (candidate.length === 0) continue;
    next = next.split(candidate).join("");
  }
  return next.replace(/[ \t]{2,}/g, " ").trimEnd();
}

function sourceUrlCandidates(sourceUrl: string): string[] {
  const trimmed = sourceUrl.trim();
  if (trimmed.length === 0) return [];

  const withoutTrailingSlash = trimmed.replace(/\/+$/, "");
  const candidates = new Set([trimmed, withoutTrailingSlash]);

  if (withoutTrailingSlash.startsWith("https://")) {
    candidates.add(withoutTrailingSlash.replace(/^https:\/\//, "http://"));
  }

  if (withoutTrailingSlash.startsWith("http://")) {
    candidates.add(withoutTrailingSlash.replace(/^http:\/\//, "https://"));
  }

  return [...candidates];
}

async function storeTelegramMediaMetadata(repository: MediaAssetsRepository, itemId: string, media: ParsedTelegramMedia[]): Promise<void> {
  await repository.createMany(media.map((entry, index) => ({
    id: `telegram_media_${stableHash(`${itemId}:${entry.fileId}:${index}`)}`,
    itemId,
    kind: mediaKind(entry.kind),
    status: "ready",
    sourceUrl: `telegram://file/${entry.fileId}`,
    ...(entry.mimeType === undefined ? {} : { mimeType: entry.mimeType }),
    ...(entry.fileSize === undefined ? {} : { sizeBytes: entry.fileSize }),
    ...(entry.width === undefined ? {} : { width: entry.width }),
    ...(entry.height === undefined ? {} : { height: entry.height }),
    ...(entry.durationSeconds === undefined ? {} : { durationSeconds: entry.durationSeconds }),
    telegramFileId: entry.fileId,
    ...(entry.fileUniqueId === undefined ? {} : { telegramFileUniqueId: entry.fileUniqueId }),
    ...(entry.mediaGroupId === undefined ? {} : { telegramMediaGroupId: entry.mediaGroupId }),
    telegramFileType: entry.kind,
    ...(entry.mimeType === undefined ? {} : { telegramMimeType: entry.mimeType }),
    ...(entry.fileSize === undefined ? {} : { telegramFileSize: entry.fileSize })
  })));
}

function mediaKind(kind: ParsedTelegramMedia["kind"]): NormalizedMedia["kind"] {
  if (kind === "photo") return "image";
  if (kind === "video" || kind === "animation") return "video";
  return "link_preview";
}

function toNormalizedMedia(media: ParsedTelegramMedia): NormalizedMedia {
  return {
    kind: mediaKind(media.kind),
    sourceUrl: `telegram://file/${media.fileId}`,
    ...(media.mimeType === undefined ? {} : { mimeType: media.mimeType }),
    ...(media.width === undefined ? {} : { width: media.width }),
    ...(media.height === undefined ? {} : { height: media.height }),
    ...(media.durationSeconds === undefined ? {} : { durationSeconds: media.durationSeconds })
  };
}

function createTopicSourcePostId(parsed: ParsedManualTelegramMessage): string {
  return `telegram-topic:${parsed.chatId}:${parsed.threadId ?? "none"}:${parsed.messageId}`;
}

function createOriginalExcerpt(value: string, maxLength = 240): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.length <= maxLength ? trimmed : `${trimmed.slice(0, maxLength - 1)}…`;
}

function estimateTokens(value: string): number {
  return Math.max(1, Math.ceil(value.length / 4));
}

function stableHash(value: string): string {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(index);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
