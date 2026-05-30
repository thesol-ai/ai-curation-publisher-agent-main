import type { D1DatabaseLike } from "../client";

export type ReviewMessageRecord = {
  id: string;
  item_id: string;
  telegram_chat_id: string;
  telegram_message_id: string;
  review_status: string;
  edited_caption?: string;
  sent_at: string;
  updated_at: string;
};

export type CreateReviewMessageInput = {
  itemId: string;
  telegramChatId: string;
  telegramMessageId: string;
  reviewStatus?: string;
  editedCaption?: string;
};

export class ReviewMessagesRepository {
  constructor(private readonly db: D1DatabaseLike) {}

  async findByTelegramMessage(chatId: string, messageId: string): Promise<ReviewMessageRecord | null> {
    return this.db.prepare("SELECT * FROM review_messages WHERE telegram_chat_id = ? AND telegram_message_id = ?").bind(chatId, messageId).first<ReviewMessageRecord>();
  }

  async createReviewMessage(input: CreateReviewMessageInput): Promise<ReviewMessageRecord> {
    const now = new Date().toISOString();
    const record: ReviewMessageRecord = {
      id: `review_${input.telegramChatId}_${input.telegramMessageId}`,
      item_id: input.itemId,
      telegram_chat_id: input.telegramChatId,
      telegram_message_id: input.telegramMessageId,
      review_status: input.reviewStatus ?? "sent",
      ...(input.editedCaption === undefined ? {} : { edited_caption: input.editedCaption }),
      sent_at: now,
      updated_at: now
    };

    await this.db.prepare(
      `INSERT OR REPLACE INTO review_messages (id, item_id, telegram_chat_id, telegram_message_id, review_status, edited_caption, sent_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      record.id,
      record.item_id,
      record.telegram_chat_id,
      record.telegram_message_id,
      record.review_status,
      record.edited_caption ?? null,
      record.sent_at,
      record.updated_at
    ).run();

    return record;
  }
}
