import type { D1DatabaseLike } from "../client";

export const TELEGRAM_PUBLISH_QUEUE_STATUSES = ["pending", "scheduled", "publishing", "published", "failed", "cancelled"] as const;
export type TelegramPublishQueueStatus = typeof TELEGRAM_PUBLISH_QUEUE_STATUSES[number];

export type TelegramPublishQueueRecord = {
  id: string;
  itemId: string;
  generatedOutputId: string;
  routeId: string;
  routeOutputId: string;
  language: string;
  finalChatId: string;
  finalThreadId?: number;
  status: TelegramPublishQueueStatus;
  scheduledFor?: string;
  priority: number;
  attemptCount: number;
  lastError?: string;
  finalMessageId?: string;
  createdAt: string;
  updatedAt: string;
};

export type EnqueueTelegramPublishInput = {
  itemId: string;
  generatedOutputId: string;
  routeId: string;
  routeOutputId: string;
  language: string;
  finalChatId: string;
  finalThreadId?: number;
  scheduledFor?: string;
  priority?: number;
};

type TelegramPublishQueueRow = {
  id: string;
  item_id: string;
  generated_output_id: string;
  route_id: string;
  route_output_id: string;
  language: string;
  final_chat_id: string;
  final_thread_id: number | null;
  status: TelegramPublishQueueStatus;
  scheduled_for: string | null;
  priority?: number | null;
  attempt_count: number;
  last_error: string | null;
  final_message_id: string | null;
  created_at: string;
  updated_at: string;
};

export class TelegramPublishQueueRepository {
  constructor(private readonly db: D1DatabaseLike) {}

  async enqueue(input: EnqueueTelegramPublishInput): Promise<TelegramPublishQueueRecord> {
    const existing = await this.findByGeneratedOutputId(input.generatedOutputId);
    if (existing) {
      return existing;
    }

    const now = new Date().toISOString();
    const id = createTelegramPublishQueueId(input.generatedOutputId);
    const status: TelegramPublishQueueStatus = input.scheduledFor === undefined ? "pending" : "scheduled";

    await this.db.prepare(
      `INSERT INTO telegram_publish_queue (id, item_id, generated_output_id, route_id, route_output_id, language, final_chat_id, final_thread_id, status, scheduled_for, priority, attempt_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      id,
      input.itemId,
      input.generatedOutputId,
      input.routeId,
      input.routeOutputId,
      input.language,
      input.finalChatId,
      input.finalThreadId ?? null,
      status,
      input.scheduledFor ?? null,
      input.priority ?? 0,
      0,
      now,
      now
    ).run();

    return {
      id,
      itemId: input.itemId,
      generatedOutputId: input.generatedOutputId,
      routeId: input.routeId,
      routeOutputId: input.routeOutputId,
      language: input.language,
      finalChatId: input.finalChatId,
      ...(input.finalThreadId === undefined ? {} : { finalThreadId: input.finalThreadId }),
      status,
      ...(input.scheduledFor === undefined ? {} : { scheduledFor: input.scheduledFor }),
      priority: input.priority ?? 0,
      attemptCount: 0,
      createdAt: now,
      updatedAt: now
    };
  }

  async findByGeneratedOutputId(generatedOutputId: string): Promise<TelegramPublishQueueRecord | null> {
    const row = await this.db.prepare("SELECT * FROM telegram_publish_queue WHERE generated_output_id = ? LIMIT 1")
      .bind(generatedOutputId)
      .first<TelegramPublishQueueRow>();
    return row ? toRecord(row) : null;
  }

  async findById(id: string): Promise<TelegramPublishQueueRecord | null> {
    const row = await this.db.prepare("SELECT * FROM telegram_publish_queue WHERE id = ? LIMIT 1")
      .bind(id)
      .first<TelegramPublishQueueRow>();
    return row ? toRecord(row) : null;
  }


  async listRecent(limit = 25, status?: TelegramPublishQueueStatus): Promise<TelegramPublishQueueRecord[]> {
    const cappedLimit = Math.max(1, Math.min(Math.floor(limit), 100));
    const sql = status === undefined
      ? `SELECT * FROM telegram_publish_queue ORDER BY updated_at DESC, created_at DESC LIMIT ?`
      : `SELECT * FROM telegram_publish_queue WHERE status = ? ORDER BY updated_at DESC, created_at DESC LIMIT ?`;
    const statement = this.db.prepare(sql);
    const result = status === undefined
      ? await statement.bind(cappedLimit).all<TelegramPublishQueueRow>()
      : await statement.bind(status, cappedLimit).all<TelegramPublishQueueRow>();
    return (result.results ?? []).map(toRecord);
  }

  async listDue(nowIso: string, limit = 5): Promise<TelegramPublishQueueRecord[]> {
    const cappedLimit = Math.max(1, Math.min(Math.floor(limit), 25));
    const result = await this.db.prepare(
      `SELECT * FROM telegram_publish_queue
       WHERE status IN ('pending', 'scheduled') AND (scheduled_for IS NULL OR scheduled_for <= ?)
       ORDER BY priority DESC, COALESCE(scheduled_for, created_at) ASC, created_at ASC
       LIMIT ?`
    ).bind(nowIso, cappedLimit).all<TelegramPublishQueueRow>();
    return (result.results ?? []).map(toRecord);
  }

  async findLatestForFinalTarget(finalChatId: string, finalThreadId?: number): Promise<TelegramPublishQueueRecord | null> {
    const sql = finalThreadId === undefined
      ? `SELECT * FROM telegram_publish_queue WHERE final_chat_id = ? AND final_thread_id IS NULL AND status IN ('pending', 'scheduled', 'publishing', 'published') ORDER BY COALESCE(scheduled_for, updated_at, created_at) DESC LIMIT 1`
      : `SELECT * FROM telegram_publish_queue WHERE final_chat_id = ? AND final_thread_id = ? AND status IN ('pending', 'scheduled', 'publishing', 'published') ORDER BY COALESCE(scheduled_for, updated_at, created_at) DESC LIMIT 1`;
    const statement = this.db.prepare(sql);
    const row = finalThreadId === undefined
      ? await statement.bind(finalChatId).first<TelegramPublishQueueRow>()
      : await statement.bind(finalChatId, finalThreadId).first<TelegramPublishQueueRow>();
    return row ? toRecord(row) : null;
  }

  async countForFinalTargetBetween(finalChatId: string, startIso: string, endIso: string, finalThreadId?: number): Promise<number> {
    const sql = finalThreadId === undefined
      ? `SELECT COUNT(*) AS count FROM telegram_publish_queue WHERE final_chat_id = ? AND final_thread_id IS NULL AND status IN ('pending', 'scheduled', 'publishing', 'published') AND COALESCE(scheduled_for, created_at) >= ? AND COALESCE(scheduled_for, created_at) < ?`
      : `SELECT COUNT(*) AS count FROM telegram_publish_queue WHERE final_chat_id = ? AND final_thread_id = ? AND status IN ('pending', 'scheduled', 'publishing', 'published') AND COALESCE(scheduled_for, created_at) >= ? AND COALESCE(scheduled_for, created_at) < ?`;
    const statement = this.db.prepare(sql);
    const row = finalThreadId === undefined
      ? await statement.bind(finalChatId, startIso, endIso).first<{ count: number }>()
      : await statement.bind(finalChatId, finalThreadId, startIso, endIso).first<{ count: number }>();
    return row?.count ?? 0;
  }

  async markPublishing(id: string): Promise<void> {
    await this.db.prepare("UPDATE telegram_publish_queue SET status = 'publishing', attempt_count = attempt_count + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .bind(id)
      .run();
  }

  async markPublished(id: string, finalMessageId: string): Promise<void> {
    await this.db.prepare("UPDATE telegram_publish_queue SET status = 'published', final_message_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .bind(finalMessageId, id)
      .run();
  }

  async markFailed(id: string, errorMessage: string): Promise<void> {
    await this.db.prepare("UPDATE telegram_publish_queue SET status = 'failed', last_error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .bind(errorMessage, id)
      .run();
  }

  async markCancelled(id: string, reason = "Cancelled from dashboard."): Promise<void> {
    await this.db.prepare("UPDATE telegram_publish_queue SET status = 'cancelled', last_error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .bind(reason, id)
      .run();
  }

  async reschedule(id: string, scheduledFor: string): Promise<void> {
    await this.db.prepare("UPDATE telegram_publish_queue SET status = 'scheduled', scheduled_for = ?, last_error = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .bind(scheduledFor, id)
      .run();
  }
}

function toRecord(row: TelegramPublishQueueRow): TelegramPublishQueueRecord {
  return {
    id: row.id,
    itemId: row.item_id,
    generatedOutputId: row.generated_output_id,
    routeId: row.route_id,
    routeOutputId: row.route_output_id,
    language: row.language,
    finalChatId: row.final_chat_id,
    ...(row.final_thread_id === null ? {} : { finalThreadId: row.final_thread_id }),
    status: row.status,
    ...(row.scheduled_for === null ? {} : { scheduledFor: row.scheduled_for }),
    priority: row.priority ?? 0,
    attemptCount: row.attempt_count,
    ...(row.last_error === null ? {} : { lastError: row.last_error }),
    ...(row.final_message_id === null ? {} : { finalMessageId: row.final_message_id }),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function createTelegramPublishQueueId(generatedOutputId: string): string {
  return `tgpub_${stableHash(generatedOutputId)}`;
}

function stableHash(value: string): string {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(index);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
