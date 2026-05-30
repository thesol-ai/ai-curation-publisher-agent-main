import {
  ItemsRepository,
  TelegramGeneratedOutputsRepository,
  TelegramPublishQueueRepository,
  TelegramReviewMessagesRepository,
  TelegramRoutesRepository,
  type TelegramGeneratedOutputRecord,
  type TelegramLocalizedOutput
} from "@curator/db";
import {
  buildTelegramOutputReviewStatefulInlineKeyboard,
  RealTelegramClient,
  type ParsedManualTelegramMessage,
  type TelegramClient
} from "@curator/telegram";
import type { Env } from "../types";
import { applyRouteOutputSignature } from "./channel-signature";
import { refreshTelegramReviewMessageState } from "./review-message-state";

const MAX_EDITED_CAPTION_LENGTH = 1000;
const EDITABLE_OUTPUT_STATUSES = new Set(["generated", "ready_for_review", "failed"]);

export type TelegramReviewEditReplyResult = {
  ok: boolean;
  kind: "review_edit_reply";
  consumed: true;
  generatedOutputId?: string;
  reviewMessageId?: string;
  status?: string;
  message: string;
};

export async function handleTelegramReviewEditReply(input: {
  env: Env;
  parsed: ParsedManualTelegramMessage;
  telegramClient?: TelegramClient | undefined;
}): Promise<TelegramReviewEditReplyResult | null> {
  const replyToMessageId = input.parsed.message.reply_to_message?.message_id;
  if (replyToMessageId === undefined) return null;

  const reviewMessagesRepository = new TelegramReviewMessagesRepository(input.env.DB);
  const reviewMessage = await reviewMessagesRepository.findByChatAndMessageId(input.parsed.chatId, replyToMessageId);
  if (!reviewMessage) return null;

  const generatedOutputsRepository = new TelegramGeneratedOutputsRepository(input.env.DB);
  const publishQueueRepository = new TelegramPublishQueueRepository(input.env.DB);
  const routesRepository = new TelegramRoutesRepository(input.env.DB);
  const itemsRepository = new ItemsRepository(input.env.DB);
  const telegramClient = input.telegramClient ?? createReviewUpdateClient(input.env);

  const generatedOutput = await generatedOutputsRepository.findById(reviewMessage.generatedOutputId);
  if (!generatedOutput) {
    return { ok: false, kind: "review_edit_reply", consumed: true, reviewMessageId: reviewMessage.id, message: "Review output was not found." };
  }

  const existingQueueItem = await publishQueueRepository.findByGeneratedOutputId(generatedOutput.id);
  if (existingQueueItem) {
    await telegramClient?.editReviewMessageReplyMarkup({
      chatId: reviewMessage.chatId,
      messageId: reviewMessage.messageId,
      replyMarkup: buildTelegramOutputReviewStatefulInlineKeyboard({
        callbackToken: generatedOutput.id,
        generatedStatus: generatedOutput.status,
        publishQueueStatus: existingQueueItem.status,
        ...(existingQueueItem.scheduledFor === undefined ? {} : { scheduledFor: existingQueueItem.scheduledFor }),
        ...(existingQueueItem.finalMessageId === undefined ? {} : { finalMessageId: existingQueueItem.finalMessageId }),
        finalPublishingEnabled: isFinalPublishingEnabled(input.env)
      })
    });
    return {
      ok: false,
      kind: "review_edit_reply",
      consumed: true,
      generatedOutputId: generatedOutput.id,
      reviewMessageId: reviewMessage.id,
      status: generatedOutput.status,
      message: `This output already has a publish queue row (${existingQueueItem.status}). Edit is only allowed before Send/Schedule creates a queue row.`
    };
  }

  if (!EDITABLE_OUTPUT_STATUSES.has(generatedOutput.status)) {
    await refreshTelegramReviewMessageState({ env: input.env, generatedOutputId: generatedOutput.id, telegramClient });
    return {
      ok: false,
      kind: "review_edit_reply",
      consumed: true,
      generatedOutputId: generatedOutput.id,
      reviewMessageId: reviewMessage.id,
      status: generatedOutput.status,
      message: `This output cannot be edited while status is ${generatedOutput.status}.`
    };
  }

  const caption = input.parsed.text.trim();
  if (caption.length === 0) {
    return {
      ok: false,
      kind: "review_edit_reply",
      consumed: true,
      generatedOutputId: generatedOutput.id,
      reviewMessageId: reviewMessage.id,
      status: generatedOutput.status,
      message: "Edited caption is empty. Reply with the revised caption text."
    };
  }
  if (caption.length > MAX_EDITED_CAPTION_LENGTH) {
    return {
      ok: false,
      kind: "review_edit_reply",
      consumed: true,
      generatedOutputId: generatedOutput.id,
      reviewMessageId: reviewMessage.id,
      status: generatedOutput.status,
      message: `Edited caption is too long. Keep it under ${MAX_EDITED_CAPTION_LENGTH} characters so Telegram media publishing remains safe.`
    };
  }

  const editedAt = new Date().toISOString();
  const updatedOutput = await generatedOutputsRepository.updateCaption(generatedOutput.id, caption, {
    editedBy: input.parsed.reviewerId,
    editedAt
  });
  const outputForView = updatedOutput ?? { ...generatedOutput, output: { ...generatedOutput.output, caption, editedBy: input.parsed.reviewerId, editedAt } as TelegramLocalizedOutput };
  const route = await routesRepository.findRouteById(generatedOutput.routeId);
  const routeOutput = await routesRepository.findOutputById(generatedOutput.routeOutputId);
  const item = await itemsRepository.findById(generatedOutput.itemId);
  const queueItem = await publishQueueRepository.findByGeneratedOutputId(generatedOutput.id);
  const sourceUrl = item?.canonicalUrl ?? "";
  const displayCaption = routeOutput ? applyRouteOutputSignature(caption, routeOutput) : caption;

  if (telegramClient) {
    await telegramClient.editReviewMessage({
      chatId: reviewMessage.chatId,
      messageId: reviewMessage.messageId,
      text: buildEditedReviewMessageText({
        generatedOutput: outputForView,
        category: route?.category ?? "unknown",
        language: routeOutput?.language ?? generatedOutput.language,
        caption: displayCaption,
        sourceUrl,
        editedBy: input.parsed.reviewerId,
        editedAt,
        status: generatedOutput.status
      }),
      replyMarkup: buildTelegramOutputReviewStatefulInlineKeyboard({
        callbackToken: generatedOutput.id,
        generatedStatus: generatedOutput.status,
        ...(queueItem === null ? {} : { publishQueueStatus: queueItem.status }),
        ...(queueItem?.scheduledFor === undefined ? {} : { scheduledFor: queueItem.scheduledFor }),
        ...(queueItem?.finalMessageId === undefined ? {} : { finalMessageId: queueItem.finalMessageId }),
        finalPublishingEnabled: isFinalPublishingEnabled(input.env),
        ...(sourceUrl.trim().length === 0 ? {} : { sourceButtonUrl: sourceUrl })
      })
    });
  }

  return {
    ok: true,
    kind: "review_edit_reply",
    consumed: true,
    generatedOutputId: generatedOutput.id,
    reviewMessageId: reviewMessage.id,
    status: generatedOutput.status,
    message: "Review caption updated. The revised caption will be used when this output is sent."
  };
}

export async function markTelegramReviewEditRequested(input: {
  env: Env;
  generatedOutputId: string;
  telegramClient?: TelegramClient | undefined;
}): Promise<void> {
  const generatedOutputsRepository = new TelegramGeneratedOutputsRepository(input.env.DB);
  const publishQueueRepository = new TelegramPublishQueueRepository(input.env.DB);
  const reviewMessagesRepository = new TelegramReviewMessagesRepository(input.env.DB);
  const itemsRepository = new ItemsRepository(input.env.DB);
  const telegramClient = input.telegramClient ?? createReviewUpdateClient(input.env);
  if (!telegramClient) return;

  const generatedOutput = await generatedOutputsRepository.findById(input.generatedOutputId);
  if (!generatedOutput) return;
  const reviewMessage = await reviewMessagesRepository.findByGeneratedOutputId(generatedOutput.id);
  if (!reviewMessage || reviewMessage.status !== "sent") return;
  const queueItem = await publishQueueRepository.findByGeneratedOutputId(generatedOutput.id);
  const item = await itemsRepository.findById(generatedOutput.itemId);

  await telegramClient.editReviewMessageReplyMarkup({
    chatId: reviewMessage.chatId,
    messageId: reviewMessage.messageId,
    replyMarkup: buildTelegramOutputReviewStatefulInlineKeyboard({
      callbackToken: generatedOutput.id,
      generatedStatus: generatedOutput.status,
      ...(queueItem === null ? {} : { publishQueueStatus: queueItem.status }),
      ...(queueItem?.scheduledFor === undefined ? {} : { scheduledFor: queueItem.scheduledFor }),
      ...(queueItem?.finalMessageId === undefined ? {} : { finalMessageId: queueItem.finalMessageId }),
      finalPublishingEnabled: isFinalPublishingEnabled(input.env),
      editRequested: true,
      ...(item?.canonicalUrl === undefined ? {} : { sourceButtonUrl: item.canonicalUrl })
    })
  });
}

function buildEditedReviewMessageText(input: {
  generatedOutput: TelegramGeneratedOutputRecord;
  category: string;
  language: string;
  caption: string;
  sourceUrl: string;
  editedBy: string;
  editedAt: string;
  status: string;
}): string {
  const output = input.generatedOutput.output as TelegramLocalizedOutput;
  const summary = output.summary?.trim();
  const riskFlags = output.riskFlags.length > 0 ? output.riskFlags.join(", ") : "none";
  return [
    "✏️ Edited review caption",
    "",
    input.caption,
    "",
    "🔴 Review controls",
    "",
    `Item: ${input.generatedOutput.itemId}`,
    `Output: ${input.generatedOutput.id}`,
    `Category: ${input.category}`,
    `Language: ${input.language}`,
    `Status: ${input.status}`,
    `Edited by: ${input.editedBy}`,
    `Edited at: ${input.editedAt}`,
    input.sourceUrl.trim().length > 0 ? `Source: ${input.sourceUrl}` : undefined,
    summary ? `Summary: ${summary}` : undefined,
    `Risk flags: ${riskFlags}`,
    "",
    "Reply to this review message again to replace the caption before sending."
  ].filter((entry): entry is string => typeof entry === "string").join("\n");
}

function createReviewUpdateClient(env: Env): TelegramClient | undefined {
  const botToken = env.TELEGRAM_BOT_TOKEN?.trim();
  if (!botToken) return undefined;
  return new RealTelegramClient({ botToken });
}

function isFinalPublishingEnabled(env: Env): boolean {
  return (env as Env & { TELEGRAM_FINAL_PUBLISH_ENABLED?: string }).TELEGRAM_FINAL_PUBLISH_ENABLED === "true";
}
