import {
  ItemsRepository,
  TelegramGeneratedOutputsRepository,
  TelegramPublishQueueRepository,
  TelegramReviewMessagesRepository
} from "@curator/db";
import { buildTelegramOutputReviewStatefulInlineKeyboard, RealTelegramClient, type TelegramClient } from "@curator/telegram";
import type { Env } from "../types";

export type RefreshTelegramReviewMessageStateInput = {
  env: Env;
  generatedOutputId: string;
  telegramClient?: TelegramClient | undefined;
};

export async function refreshTelegramReviewMessageState(input: RefreshTelegramReviewMessageStateInput): Promise<void> {
  const telegramClient = input.telegramClient ?? createReviewUpdateClient(input.env);
  if (!telegramClient) return;

  try {
    const generatedOutputsRepository = new TelegramGeneratedOutputsRepository(input.env.DB);
    const publishQueueRepository = new TelegramPublishQueueRepository(input.env.DB);
    const reviewMessagesRepository = new TelegramReviewMessagesRepository(input.env.DB);
    const itemsRepository = new ItemsRepository(input.env.DB);

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
        ...(queueItem?.lastError === undefined ? {} : { lastError: queueItem.lastError }),
        finalPublishingEnabled: isFinalPublishingEnabled(input.env),
        ...(item?.canonicalUrl === undefined ? {} : { sourceButtonUrl: item.canonicalUrl })
      })
    });
  } catch (error) {
    console.warn("Telegram review message state refresh failed", {
      generatedOutputId: input.generatedOutputId,
      message: error instanceof Error ? error.message : "unknown error"
    });
  }
}

function createReviewUpdateClient(env: Env): TelegramClient | undefined {
  const botToken = env.TELEGRAM_BOT_TOKEN?.trim();
  if (!botToken) return undefined;
  return new RealTelegramClient({ botToken });
}

function isFinalPublishingEnabled(env: Env): boolean {
  return (env as Env & { TELEGRAM_FINAL_PUBLISH_ENABLED?: string }).TELEGRAM_FINAL_PUBLISH_ENABLED === "true";
}
