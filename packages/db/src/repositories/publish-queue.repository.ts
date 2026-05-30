import type { OutputTarget } from "@curator/core";
import type { D1DatabaseLike } from "../client";

export type PublishQueueStatus = "pending" | "scheduled" | "published" | "failed";

export type PublishQueueRecord = {
  id: string;
  itemId: string;
  target: OutputTarget;
  status: PublishQueueStatus;
  scheduledFor?: string;
  attemptCount: number;
  lastError?: string;
  finalMessageId?: string;
  createdAt: string;
  updatedAt: string;
};

export type EnqueuePublishItemInput = {
  itemId: string;
  target: OutputTarget;
  scheduledFor?: string;
};

type PublishQueueRow = {
  id: string;
  item_id: string;
  target: OutputTarget;
  status: PublishQueueStatus;
  scheduled_for: string | null;
  attempt_count: number;
  last_error: string | null;
  final_message_id: string | null;
  created_at: string;
  updated_at: string;
};

export class PublishQueueRepository {
  constructor(private readonly db: D1DatabaseLike) {}

  async findExistingPendingOrScheduled(itemId: string, target: OutputTarget): Promise<PublishQueueRecord | null> {
    const row = await this.db
      .prepare("SELECT * FROM publish_queue WHERE item_id = ? AND target = ? AND status IN ('pending', 'scheduled') ORDER BY created_at ASC LIMIT 1")
      .bind(itemId, target)
      .first<PublishQueueRow>();

    return row ? toPublishQueueRecord(row) : null;
  }

  async enqueue(input: EnqueuePublishItemInput): Promise<PublishQueueRecord> {
    const existing = await this.findExistingPendingOrScheduled(input.itemId, input.target);
    if (existing) {
      return existing;
    }

    const now = new Date().toISOString();
    const id = createPublishQueueId(input.itemId, input.target);
    const status: PublishQueueStatus = input.scheduledFor === undefined ? "pending" : "scheduled";

    await this.db.prepare(
      "INSERT INTO publish_queue (id, item_id, target, status, scheduled_for, attempt_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(
      id,
      input.itemId,
      input.target,
      status,
      input.scheduledFor === undefined ? null : input.scheduledFor,
      0,
      now,
      now
    ).run();

    return {
      id,
      itemId: input.itemId,
      target: input.target,
      status,
      ...(input.scheduledFor === undefined ? {} : { scheduledFor: input.scheduledFor }),
      attemptCount: 0,
      createdAt: now,
      updatedAt: now
    };
  }

  async getNextPublishable(target: OutputTarget, nowIso: string): Promise<PublishQueueRecord | null> {
    const row = await this.db
      .prepare("SELECT * FROM publish_queue WHERE target = ? AND status IN ('pending', 'scheduled') AND (scheduled_for IS NULL OR scheduled_for <= ?) ORDER BY COALESCE(scheduled_for, created_at) ASC LIMIT 1")
      .bind(target, nowIso)
      .first<PublishQueueRow>();

    return row ? toPublishQueueRecord(row) : null;
  }

  async markScheduled(id: string, scheduledFor: string): Promise<void> {
    await this.db
      .prepare("UPDATE publish_queue SET status = 'scheduled', scheduled_for = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .bind(scheduledFor, id)
      .run();
  }

  async markPublished(id: string, finalMessageId: string): Promise<void> {
    await this.db
      .prepare("UPDATE publish_queue SET status = 'published', final_message_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .bind(finalMessageId, id)
      .run();
  }

  async markFailed(id: string, errorMessage: string): Promise<void> {
    await this.db
      .prepare("UPDATE publish_queue SET status = 'failed', attempt_count = attempt_count + 1, last_error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .bind(errorMessage, id)
      .run();
  }

  async countPublishedForDay(target: OutputTarget, dayStartIso: string, dayEndIso: string): Promise<number> {
    const row = await this.db
      .prepare("SELECT COUNT(*) AS count FROM publish_queue WHERE target = ? AND status = 'published' AND updated_at >= ? AND updated_at < ?")
      .bind(target, dayStartIso, dayEndIso)
      .first<{ count: number }>();

    return row?.count ?? 0;
  }
}

function toPublishQueueRecord(row: PublishQueueRow): PublishQueueRecord {
  return {
    id: row.id,
    itemId: row.item_id,
    target: row.target,
    status: row.status,
    ...(row.scheduled_for === null ? {} : { scheduledFor: row.scheduled_for }),
    attemptCount: row.attempt_count,
    ...(row.last_error === null ? {} : { lastError: row.last_error }),
    ...(row.final_message_id === null ? {} : { finalMessageId: row.final_message_id }),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function createPublishQueueId(itemId: string, target: OutputTarget): string {
  return `publish_${stableHash(`${itemId}:${target}`)}`;
}

function stableHash(value: string): string {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(index);
  }

  return (hash >>> 0).toString(16).padStart(8, "0");
}
