import type { TelegramAiOutput } from "@curator/core";
import { ItemsRepository } from "../repositories/items.repository";
import { OutputsRepository } from "../repositories/outputs.repository";
import { PublishQueueRepository, type PublishQueueRecord } from "../repositories/publish-queue.repository";
import { PublishQueueService } from "./publish-queue.service";

export type FinalTelegramMessageInput = {
  chatId: string;
  text: string;
};

export type FinalTelegramMessage = {
  chatId: string;
  messageId: string;
  text: string;
};

export interface TelegramFinalPublisher {
  publishFinalMessage(input: FinalTelegramMessageInput): Promise<FinalTelegramMessage>;
}

export type PublishNextTelegramInput = {
  finalChatId: string;
  now?: Date;
  publishNow?: boolean;
};

export type PublishNextTelegramResult =
  | {
      outcome: "published";
      queueItem: PublishQueueRecord;
      itemId: string;
      finalMessageId: string;
    }
  | {
      outcome: "none";
      reason: "no_publishable_item";
    }
  | {
      outcome: "failed";
      queueItem: PublishQueueRecord;
      itemId: string;
      errorMessage: string;
    };

export class PublishingService {
  constructor(
    private readonly queueService: PublishQueueService,
    private readonly outputsRepository: OutputsRepository,
    private readonly itemsRepository: ItemsRepository,
    private readonly telegramPublisher: TelegramFinalPublisher
  ) {}

  static fromRepositories(input: {
    queueRepository: PublishQueueRepository;
    outputsRepository: OutputsRepository;
    itemsRepository: ItemsRepository;
    telegramPublisher: TelegramFinalPublisher;
  }): PublishingService {
    return new PublishingService(
      new PublishQueueService(input.queueRepository, input.itemsRepository),
      input.outputsRepository,
      input.itemsRepository,
      input.telegramPublisher
    );
  }

  async publishNextTelegram(input: PublishNextTelegramInput): Promise<PublishNextTelegramResult> {
    const queueItem = await this.queueService.getNextPublishableItem("telegram", input.now ?? new Date(), input.publishNow ?? false);
    if (!queueItem) {
      return { outcome: "none", reason: "no_publishable_item" };
    }

    try {
      const finalText = await this.buildFinalTelegramMessage(queueItem.itemId);
      const message = await this.telegramPublisher.publishFinalMessage({
        chatId: input.finalChatId,
        text: finalText
      });

      await this.queueService.markPublished(queueItem.id, queueItem.itemId, message.messageId);

      return {
        outcome: "published",
        queueItem,
        itemId: queueItem.itemId,
        finalMessageId: message.messageId
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown publish failure";
      await this.queueService.markFailed(queueItem.id, errorMessage);

      return {
        outcome: "failed",
        queueItem,
        itemId: queueItem.itemId,
        errorMessage
      };
    }
  }

  private async buildFinalTelegramMessage(itemId: string): Promise<string> {
    const output = await this.outputsRepository.findLatestForItem(itemId, "telegram");
    if (output) {
      return formatTelegramOutput(output.output as TelegramAiOutput);
    }

    const item = await this.itemsRepository.findById(itemId);
    if (item?.text?.trim()) {
      return item.text.trim();
    }

    return `Published item: ${itemId}`;
  }
}

function formatTelegramOutput(output: TelegramAiOutput): string {
  const caption = output.telegram_caption_fa || "";
  const summary = output.summary_fa ? `\n\nخلاصه: ${output.summary_fa}` : "";
  const hashtags = output.hashtags.length > 0 ? `\n\n${output.hashtags.join(" ")}` : "";
  return `${caption}${summary}${hashtags}`.trim();
}
