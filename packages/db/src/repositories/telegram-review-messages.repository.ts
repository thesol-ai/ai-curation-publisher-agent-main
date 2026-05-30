import type { D1DatabaseLike } from "../client";

export type TelegramReviewMessageRecord = {
  id: string;
  generatedOutputId: string;
  itemId: string;
  routeId: string;
  routeOutputId: string;
  language: string;
  chatId: string;
  threadId: number;
  messageId: string;
  status: string;
  createdAt: string;
  updatedAt: string;
};

export type CreateTelegramReviewMessageInput = {
  generatedOutputId: string;
  itemId: string;
  routeId: string;
  routeOutputId: string;
  language: string;
  chatId: string;
  threadId: number;
  messageId: string;
  status?: string;
};

type TelegramReviewMessageRow = {
  id: string;
  generated_output_id: string;
  item_id: string;
  route_id: string;
  route_output_id: string;
  language: string;
  chat_id: string;
  thread_id: number;
  message_id: string;
  status: string;
  created_at: string;
  updated_at: string;
};

export class TelegramReviewMessagesRepository {
  constructor(private readonly db: D1DatabaseLike) {}

  async create(input: CreateTelegramReviewMessageInput): Promise<TelegramReviewMessageRecord> {
    const now = new Date().toISOString();
    const id = createTelegramReviewMessageId(input.chatId, input.messageId);
    const status = input.status ?? "sent";

    await this.db.prepare(
      `INSERT OR REPLACE INTO telegram_review_messages (id, generated_output_id, item_id, route_id, route_output_id, language, chat_id, thread_id, message_id, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      id,
      input.generatedOutputId,
      input.itemId,
      input.routeId,
      input.routeOutputId,
      input.language,
      input.chatId,
      input.threadId,
      input.messageId,
      status,
      now,
      now
    ).run();

    return {
      id,
      generatedOutputId: input.generatedOutputId,
      itemId: input.itemId,
      routeId: input.routeId,
      routeOutputId: input.routeOutputId,
      language: input.language,
      chatId: input.chatId,
      threadId: input.threadId,
      messageId: input.messageId,
      status,
      createdAt: now,
      updatedAt: now
    };
  }

  async findByGeneratedOutputId(generatedOutputId: string): Promise<TelegramReviewMessageRecord | null> {
    const row = await this.db.prepare("SELECT * FROM telegram_review_messages WHERE generated_output_id = ? ORDER BY created_at DESC LIMIT 1")
      .bind(generatedOutputId)
      .first<TelegramReviewMessageRow>();
    return row ? toRecord(row) : null;
  }

  async findByChatAndMessageId(chatId: string, messageId: string | number): Promise<TelegramReviewMessageRecord | null> {
    const row = await this.db.prepare("SELECT * FROM telegram_review_messages WHERE chat_id = ? AND message_id = ? ORDER BY created_at DESC LIMIT 1")
      .bind(chatId, String(messageId))
      .first<TelegramReviewMessageRow>();
    return row ? toRecord(row) : null;
  }
}

function toRecord(row: TelegramReviewMessageRow): TelegramReviewMessageRecord {
  return {
    id: row.id,
    generatedOutputId: row.generated_output_id,
    itemId: row.item_id,
    routeId: row.route_id,
    routeOutputId: row.route_output_id,
    language: row.language,
    chatId: row.chat_id,
    threadId: row.thread_id,
    messageId: row.message_id,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function createTelegramReviewMessageId(chatId: string, messageId: string): string {
  return `tgreview_${stableHash(`${chatId}:${messageId}`)}`;
}

function stableHash(value: string): string {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(index);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
