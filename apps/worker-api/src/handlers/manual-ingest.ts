import { AIOutputService } from "@curator/ai";
import { IngestGateService, ReviewMessagesRepository, SourcesRepository } from "@curator/db";
import type { CostControlDecision, D1DatabaseLike } from "@curator/db";
import type { ItemStatus, NormalizedPost, ValidationIssue } from "@curator/core";
import {
  buildTelegramAiReviewDraft,
  createOriginalTextExcerpt,
  MockTelegramClient,
  type ParsedManualTelegramMessage,
  type TelegramClient,
  type TelegramReviewDraft
} from "@curator/telegram";

export type ManualIngestResult = {
  itemId: string;
  status: "created" | "duplicate" | "invalid";
  lifecycleStatus: ItemStatus;
  validationIssues: ValidationIssue[];
  costControl: CostControlDecision;
  duplicateOfItemId?: string;
  reviewMessageId?: string;
  reviewChatId?: string;
  reviewDraft?: TelegramReviewDraft;
};

export type ManualIngestOptions = {
  reviewChatId?: string;
  aiOutputService?: AIOutputService;
  telegramClient?: TelegramClient;
};

export async function handleManualIngest(
  parsed: ParsedManualTelegramMessage,
  db: D1DatabaseLike,
  options: ManualIngestOptions = {}
): Promise<ManualIngestResult> {
  const sourcesRepository = new SourcesRepository(db);
  const ingestGateService = new IngestGateService(db);
  const reviewMessagesRepository = new ReviewMessagesRepository(db);
  const aiOutputService = options.aiOutputService ?? new AIOutputService();
  const telegramClient = options.telegramClient ?? new MockTelegramClient();

  const sourcePostId = createManualSourcePostId(parsed);
  const canonicalUrl = parsed.urls[0] ?? `telegram://manual/${parsed.message.chat.id}/${parsed.message.message_id}`;
  const post = createManualNormalizedPost(parsed, sourcePostId, canonicalUrl);

  await sourcesRepository.ensureManualTelegramSource();

  const gateResult = await ingestGateService.process({
    sourceId: "manual_telegram",
    post
  });

  if (gateResult.outcome === "duplicate") {
    return {
      itemId: gateResult.existingItemId ?? `duplicate_${sourcePostId}`,
      status: "duplicate",
      lifecycleStatus: gateResult.status,
      validationIssues: gateResult.validationIssues,
      costControl: gateResult.costControl,
      ...(gateResult.existingItemId === undefined ? {} : { duplicateOfItemId: gateResult.existingItemId })
    };
  }

  if (gateResult.outcome === "invalid") {
    return {
      itemId: `invalid_${sourcePostId}`,
      status: "invalid",
      lifecycleStatus: gateResult.status,
      validationIssues: gateResult.validationIssues,
      costControl: gateResult.costControl
    };
  }

  const item = gateResult.item;
  const aiResult = await aiOutputService.generateTelegramOutput({
    itemId: item.id,
    post,
    sourceAttributionText: `Source: ${canonicalUrl}`
  });
  const originalTextExcerpt = createOriginalTextExcerpt(parsed.text);
  const reviewDraft = buildTelegramAiReviewDraft({
    itemId: item.id,
    status: item.status,
    sourceUrl: canonicalUrl,
    aiOutput: aiResult.output,
    ...(originalTextExcerpt === undefined ? {} : { originalTextExcerpt }),
    provider: post.provider,
    platform: post.platform,
    sourceType: post.sourceType
  });

  const reviewChatId = options.reviewChatId ?? String(parsed.message.chat.id);
  const sentReviewMessage = await telegramClient.sendReviewMessage({
    chatId: reviewChatId,
    text: reviewDraft.text,
    replyMarkup: reviewDraft.reply_markup
  });
  await reviewMessagesRepository.createReviewMessage({
    itemId: item.id,
    telegramChatId: sentReviewMessage.chatId,
    telegramMessageId: sentReviewMessage.messageId,
    reviewStatus: "sent"
  });

  return {
    itemId: item.id,
    status: "created",
    lifecycleStatus: gateResult.status,
    validationIssues: gateResult.validationIssues,
    costControl: gateResult.costControl,
    reviewChatId: sentReviewMessage.chatId,
    reviewMessageId: sentReviewMessage.messageId,
    reviewDraft
  };
}

function createManualNormalizedPost(parsed: ParsedManualTelegramMessage, sourcePostId: string, canonicalUrl: string): NormalizedPost {
  return {
    provider: "mock_social_provider",
    platform: "manual",
    sourceType: parsed.urls.length > 0 ? "web_url" : "manual",
    sourcePostId,
    canonicalUrl,
    publishedAt: new Date((parsed.message.date ?? Math.floor(Date.now() / 1000)) * 1000).toISOString(),
    authorHandle: parsed.message.from?.username ?? `telegram_user_${parsed.reviewerId}`,
    text: parsed.text,
    links: parsed.urls,
    media: [],
    rawPayload: {
      source: "telegram_manual_ingest",
      updateId: parsed.updateId,
      chatId: String(parsed.message.chat.id),
      messageId: parsed.message.message_id
    }
  };
}

function createManualSourcePostId(parsed: ParsedManualTelegramMessage): string {
  return `telegram:${parsed.message.chat.id}:${parsed.message.message_id}`;
}
