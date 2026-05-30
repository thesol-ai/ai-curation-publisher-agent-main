import { AIOutputService, MockAIProvider } from "@curator/ai";
import {
  assertItemStatusTransition,
  createStableId,
  generateDedupeKeys,
  hashCanonicalUrl,
  hashNormalizedText,
  type ItemStatus,
  type NormalizedPost,
  type Source,
  validateNormalizedPost
} from "@curator/core";
import { MockInstagramProvider, ProviderRegistry, SourceIngestionService } from "@curator/providers";
import {
  buildReviewCallbackData,
  buildTelegramAiReviewDraft,
  createOriginalTextExcerpt,
  MockTelegramClient,
  parseReviewCallbackData
} from "@curator/telegram";
import { createMockWordPressOutput, MockWordPressClient, WordPressPublishingService } from "@curator/wordpress";

export type E2EMockPipelineResult = {
  ok: boolean;
  sourceId: string;
  itemId?: string;
  providerUsed?: string;
  normalizedCount: number;
  queuedCount: number;
  duplicateCount: number;
  invalidCount: number;
  aiOutputCreated: boolean;
  reviewMessageCreated: boolean;
  approved: boolean;
  queuedForPublish: boolean;
  telegramPublished: boolean;
  finalMessageId?: string;
  wordpressPrepared: boolean;
  wordpressPublished: boolean;
  wordpressPostId?: string;
  warnings: string[];
  errors: string[];
};

type InMemoryItem = {
  id: string;
  post: NormalizedPost;
  status: ItemStatus;
};

type InMemoryPublishQueueItem = {
  itemId: string;
  target: "telegram";
  status: "pending" | "published";
};

export async function runE2EMockPipeline(): Promise<E2EMockPipelineResult> {
  const warnings: string[] = [];
  const errors: string[] = [];
  const source = createMockSource();
  const ingestion = await ingestMockSource(source);
  const normalizedPost = ingestion.posts[0];

  if (!normalizedPost) {
    return {
      ok: false,
      sourceId: source.id,
      ...(ingestion.providerUsed === undefined ? {} : { providerUsed: ingestion.providerUsed }),
      normalizedCount: ingestion.normalizedCount,
      queuedCount: 0,
      duplicateCount: 0,
      invalidCount: 0,
      aiOutputCreated: false,
      reviewMessageCreated: false,
      approved: false,
      queuedForPublish: false,
      telegramPublished: false,
      wordpressPrepared: false,
      wordpressPublished: false,
      warnings,
      errors: ["Mock provider did not return a normalized post."]
    };
  }

  const gate = createInMemoryIngestGate();
  const ingestResult = gate.ingest(source.id, normalizedPost);
  warnings.push(...ingestResult.warnings);
  errors.push(...ingestResult.errors);

  if (ingestResult.outcome !== "queued" || !ingestResult.item) {
    return {
      ok: false,
      sourceId: source.id,
      ...(ingestion.providerUsed === undefined ? {} : { providerUsed: ingestion.providerUsed }),
      normalizedCount: ingestion.normalizedCount,
      queuedCount: ingestResult.outcome === "queued" ? 1 : 0,
      duplicateCount: ingestResult.outcome === "duplicate" ? 1 : 0,
      invalidCount: ingestResult.outcome === "invalid" ? 1 : 0,
      aiOutputCreated: false,
      reviewMessageCreated: false,
      approved: false,
      queuedForPublish: false,
      telegramPublished: false,
      wordpressPrepared: false,
      wordpressPublished: false,
      warnings,
      errors
    };
  }

  const item = ingestResult.item;
  transitionItem(item, "queued_for_ai");

  const aiService = new AIOutputService(new MockAIProvider());
  const aiOutput = await aiService.generateTelegramOutput({
    itemId: item.id,
    post: item.post,
    sourceAttributionText: `Source: ${item.post.canonicalUrl}`
  });
  transitionItem(item, "ai_processed");

  const telegramClient = new MockTelegramClient();
  const originalTextExcerpt = createOriginalTextExcerpt(item.post.text);
  const reviewDraft = buildTelegramAiReviewDraft({
    itemId: item.id,
    status: item.status,
    sourceUrl: item.post.canonicalUrl,
    aiOutput: aiOutput.output,
    ...(originalTextExcerpt === undefined ? {} : { originalTextExcerpt }),
    provider: item.post.provider,
    platform: item.post.platform,
    sourceType: item.post.sourceType
  });
  const reviewMessage = await telegramClient.sendReviewMessage({
    chatId: "mock_review_chat",
    text: reviewDraft.text,
    replyMarkup: reviewDraft.reply_markup
  });
  transitionItem(item, "sent_to_review");

  const approvalCallback = parseReviewCallbackData(buildReviewCallbackData("send", item.id));
  if (!approvalCallback || approvalCallback.action !== "send" || approvalCallback.itemId !== item.id) {
    errors.push("Approval callback could not be parsed.");
  } else {
    transitionItem(item, "approved");
  }

  const publishQueue: InMemoryPublishQueueItem[] = [];
  if (item.status === "approved") {
    transitionItem(item, "queued_for_publish");
    publishQueue.push({ itemId: item.id, target: "telegram", status: "pending" });
  }

  const finalMessage = await publishNextTelegramMessage({
    item,
    queue: publishQueue,
    telegramClient,
    text: aiOutput.output.rewrittenPersianCaption
  });

  if (finalMessage) {
    transitionItem(item, "published_telegram");
  }

  const wordpressClient = new MockWordPressClient();
  const wordpressService = new WordPressPublishingService(wordpressClient);
  const wordpressOutput = createMockWordPressOutput({
    title_fa: aiOutput.output.headline,
    excerpt_fa: aiOutput.output.shortSummary,
    body_fa: `${aiOutput.output.rewrittenPersianCaption}\n\n${aiOutput.output.sourceAttributionText}`,
    source_attribution: aiOutput.output.sourceAttributionText
  });
  const wordpressResult = await wordpressService.publish({
    itemId: item.id,
    output: wordpressOutput,
    sourceUrl: item.post.canonicalUrl,
    status: "draft"
  });

  if (wordpressResult.outcome === "published") {
    transitionItem(item, "published_wordpress");
  } else if (wordpressResult.outcome === "invalid_output") {
    errors.push(`WordPress output invalid: ${wordpressResult.issues.map((issue) => `${issue.field}:${issue.message}`).join(", ")}`);
  } else {
    errors.push(`WordPress publish failed: ${wordpressResult.errorMessage}`);
  }

  return {
    ok: errors.length === 0,
    sourceId: source.id,
    itemId: item.id,
    ...(ingestion.providerUsed === undefined ? {} : { providerUsed: ingestion.providerUsed }),
    normalizedCount: ingestion.normalizedCount,
    queuedCount: 1,
    duplicateCount: 0,
    invalidCount: 0,
    aiOutputCreated: true,
    reviewMessageCreated: Boolean(reviewMessage.messageId),
    approved: item.status === "published_wordpress" || item.status === "published_telegram" || item.status === "queued_for_publish" || item.status === "approved",
    queuedForPublish: publishQueue.length === 1,
    telegramPublished: finalMessage !== undefined,
    ...(finalMessage === undefined ? {} : { finalMessageId: finalMessage.messageId }),
    wordpressPrepared: true,
    wordpressPublished: wordpressResult.outcome === "published",
    ...(wordpressResult.outcome === "published" ? { wordpressPostId: wordpressResult.post.id } : {}),
    warnings,
    errors
  };
}

async function ingestMockSource(source: Source) {
  const registry = new ProviderRegistry();
  registry.register(new MockInstagramProvider());
  const ingestionService = new SourceIngestionService(registry);
  return ingestionService.ingestSource(source, { limit: 1 });
}

function createMockSource(): Source {
  return {
    id: "source_e2e_mock_instagram",
    platform: "instagram",
    sourceType: "profile",
    value: "e2e_demo_profile",
    providerPriority: ["mock_instagram"],
    status: "active",
    watermark: {},
    settings: {},
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString()
  };
}

function createInMemoryIngestGate() {
  const seenDedupeKeys = new Set<string>();

  return {
    ingest(sourceId: string, post: NormalizedPost): {
      outcome: "queued" | "duplicate" | "invalid";
      item?: InMemoryItem;
      warnings: string[];
      errors: string[];
    } {
      const warnings: string[] = [];
      const errors: string[] = [];
      const validation = validateNormalizedPost(post);
      if (!validation.valid) {
        errors.push(...validation.issues.map((issue) => `${issue.code}: ${issue.message}`));
        return { outcome: "invalid", warnings, errors };
      }

      const dedupeKeys = generateDedupeKeys(post);
      const duplicateKey = dedupeKeys.find((key) => seenDedupeKeys.has(`${key.keyType}:${key.keyValue}`));
      if (duplicateKey) {
        warnings.push(`Duplicate skipped by ${duplicateKey.keyType}.`);
        return { outcome: "duplicate", warnings, errors };
      }

      for (const key of dedupeKeys) {
        seenDedupeKeys.add(`${key.keyType}:${key.keyValue}`);
      }

      const item: InMemoryItem = {
        id: createStableId("item", `${sourceId}:${post.platform}:${post.sourcePostId ?? post.canonicalUrl}`),
        post,
        status: "discovered"
      };
      transitionItem(item, "normalized");
      transitionItem(item, "validated");

      void hashCanonicalUrl(post.canonicalUrl);
      if (post.text) {
        void hashNormalizedText(post.text);
      }

      return { outcome: "queued", item, warnings, errors };
    }
  };
}

function transitionItem(item: InMemoryItem, to: ItemStatus): void {
  assertItemStatusTransition(item.status, to);
  item.status = to;
}

async function publishNextTelegramMessage(input: {
  item: InMemoryItem;
  queue: InMemoryPublishQueueItem[];
  telegramClient: MockTelegramClient;
  text: string;
}) {
  const queueItem = input.queue.find((item) => item.status === "pending" && item.target === "telegram");
  if (!queueItem) {
    return undefined;
  }

  const message = await input.telegramClient.publishFinalMessage({
    chatId: "mock_final_chat",
    text: input.text
  });
  queueItem.status = "published";
  return message;
}
