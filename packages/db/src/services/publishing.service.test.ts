import { describe, expect, it } from "vitest";
import type { D1DatabaseLike, D1PreparedStatementLike, D1Result, D1RunResult, D1Value } from "../client";
import type { Item, OutputTarget } from "@curator/core";
import { ItemsRepository } from "../repositories/items.repository";
import { OutputsRepository } from "../repositories/outputs.repository";
import { PublishQueueRepository, type PublishQueueStatus } from "../repositories/publish-queue.repository";
import { PublishQueueService } from "./publish-queue.service";
import { PublishingService, type FinalTelegramMessageInput } from "./publishing.service";

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

type OutputRow = {
  id: string;
  item_id: string;
  target: OutputTarget;
  prompt_id: string | null;
  prompt_version: string;
  status: "pending" | "generated" | "schema_invalid" | "failed";
  output_json: string;
  input_tokens: number | null;
  output_tokens: number | null;
  estimated_cost_usd: number | null;
  created_at: string;
  updated_at: string;
};

class FakeStatement implements D1PreparedStatementLike {
  private values: D1Value[] = [];

  constructor(private readonly db: FakeDb, private readonly query: string) {}

  bind(...values: D1Value[]): D1PreparedStatementLike {
    this.values = values;
    return this;
  }

  async first<T = unknown>(): Promise<T | null> {
    if (this.query.includes("FROM publish_queue") && this.query.includes("status IN ('pending', 'scheduled')")) {
      const target = this.query.includes("item_id = ?") ? String(this.values[1]) : String(this.values[0]);
      const itemId = this.query.includes("item_id = ?") ? String(this.values[0]) : undefined;
      const nowIso = this.query.includes("scheduled_for <= ?") ? String(this.values[1]) : undefined;
      const match = this.db.publishQueue.find((row) => {
        const itemMatches = itemId === undefined || row.item_id === itemId;
        const targetMatches = row.target === target;
        const statusMatches = row.status === "pending" || row.status === "scheduled";
        const scheduleMatches = nowIso === undefined || row.scheduled_for === null || row.scheduled_for <= nowIso;
        return itemMatches && targetMatches && statusMatches && scheduleMatches;
      });
      return (match as T | undefined) ?? null;
    }

    if (this.query.includes("COUNT(*) AS count FROM publish_queue")) {
      const target = String(this.values[0]);
      const start = String(this.values[1]);
      const end = String(this.values[2]);
      const count = this.db.publishQueue.filter((row) => row.target === target && row.status === "published" && row.updated_at >= start && row.updated_at < end).length;
      return { count } as T;
    }

    if (this.query.includes("FROM outputs")) {
      const itemId = String(this.values[0]);
      const target = String(this.values[1]);
      return (this.db.outputs.find((row) => row.item_id === itemId && row.target === target) as T | undefined) ?? null;
    }

    if (this.query.includes("FROM items WHERE id")) {
      const itemId = String(this.values[0]);
      return (this.db.items.find((item) => item.id === itemId) as T | undefined) ?? null;
    }

    return null;
  }

  async all<T = unknown>(): Promise<D1Result<T>> {
    return { success: true, results: [] };
  }

  async run(): Promise<D1RunResult> {
    this.db.runQueries.push(this.query);

    if (this.query.includes("INSERT INTO publish_queue")) {
      this.db.publishQueue.push({
        id: String(this.values[0]),
        item_id: String(this.values[1]),
        target: this.values[2] as OutputTarget,
        status: this.values[3] as PublishQueueStatus,
        scheduled_for: this.values[4] === null ? null : String(this.values[4]),
        attempt_count: Number(this.values[5]),
        last_error: null,
        final_message_id: null,
        created_at: String(this.values[6]),
        updated_at: String(this.values[7])
      });
    }

    if (this.query.includes("UPDATE publish_queue SET status = 'scheduled'")) {
      const scheduledFor = String(this.values[0]);
      const id = String(this.values[1]);
      const row = this.db.publishQueue.find((candidate) => candidate.id === id);
      if (row) {
        row.status = "scheduled";
        row.scheduled_for = scheduledFor;
      }
    }

    if (this.query.includes("UPDATE publish_queue SET status = 'published'")) {
      const finalMessageId = String(this.values[0]);
      const id = String(this.values[1]);
      const row = this.db.publishQueue.find((candidate) => candidate.id === id);
      if (row) {
        row.status = "published";
        row.final_message_id = finalMessageId;
        row.updated_at = new Date().toISOString();
      }
    }

    if (this.query.includes("UPDATE publish_queue SET status = 'failed'")) {
      const errorMessage = String(this.values[0]);
      const id = String(this.values[1]);
      const row = this.db.publishQueue.find((candidate) => candidate.id === id);
      if (row) {
        row.status = "failed";
        row.last_error = errorMessage;
        row.attempt_count += 1;
      }
    }

    if (this.query.includes("UPDATE items SET status")) {
      const status = String(this.values[0]) as Item["status"];
      const itemId = String(this.values[1]);
      const item = this.db.items.find((candidate) => candidate.id === itemId);
      if (item) {
        item.status = status;
      }
    }

    if (this.query.includes("INSERT OR REPLACE INTO outputs")) {
      const row: OutputRow = {
        id: String(this.values[0]),
        item_id: String(this.values[1]),
        target: this.values[2] as OutputTarget,
        prompt_id: this.values[3] === null ? null : String(this.values[3]),
        prompt_version: String(this.values[4]),
        status: this.values[5] as OutputRow["status"],
        output_json: String(this.values[6]),
        input_tokens: this.values[7] === null ? null : Number(this.values[7]),
        output_tokens: this.values[8] === null ? null : Number(this.values[8]),
        estimated_cost_usd: this.values[9] === null ? null : Number(this.values[9]),
        created_at: String(this.values[10]),
        updated_at: String(this.values[11])
      };
      this.db.outputs.push(row);
    }

    return { success: true, changes: 1 };
  }
}

class FakeDb implements D1DatabaseLike {
  publishQueue: PublishQueueRow[] = [];
  outputs: OutputRow[] = [];
  items: Item[] = [makeItem("item-local")];
  runQueries: string[] = [];

  prepare(query: string): D1PreparedStatementLike {
    return new FakeStatement(this, query);
  }
}

class FakeTelegramPublisher {
  readonly published: FinalTelegramMessageInput[] = [];

  async publishFinalMessage(input: FinalTelegramMessageInput): Promise<{ chatId: string; messageId: string; text: string }> {
    this.published.push(input);
    return { chatId: input.chatId, messageId: "final-message-local", text: input.text };
  }
}

class FailingTelegramPublisher {
  async publishFinalMessage(): Promise<{ chatId: string; messageId: string; text: string }> {
    throw new Error("telegram publish failed");
  }
}

function makeItem(id: string): Item {
  return {
    id,
    sourceId: "source-local",
    provider: "mock_social_provider",
    platform: "manual",
    sourceType: "manual",
    sourcePostId: "message-local",
    canonicalUrl: "telegram://manual/chat/message",
    canonicalUrlHash: "hash-local",
    status: "approved",
    text: "fallback final message",
    links: [],
    rawPayload: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function makeServices(db = new FakeDb(), publisher = new FakeTelegramPublisher()) {
  const itemsRepository = new ItemsRepository(db);
  const queueRepository = new PublishQueueRepository(db);
  const queueService = new PublishQueueService(queueRepository, itemsRepository);
  const outputsRepository = new OutputsRepository(db);
  const publishingService = new PublishingService(queueService, outputsRepository, itemsRepository, publisher);
  return { db, queueService, outputsRepository, publishingService, publisher };
}



function firstItem(db: FakeDb): Item {
  const item = db.items[0];
  if (!item) {
    throw new Error("Expected an item.");
  }
  return item;
}

function firstPublishQueueRow(db: FakeDb): PublishQueueRow {
  const row = db.publishQueue[0];
  if (!row) {
    throw new Error("Expected a publish queue row.");
  }
  return row;
}

function firstPublishedMessage(publisher: FakeTelegramPublisher): FinalTelegramMessageInput {
  const message = publisher.published[0];
  if (!message) {
    throw new Error("Expected a published Telegram message.");
  }
  return message;
}

describe("PublishQueueService", () => {
  it("enqueues an approved item and prevents duplicate enqueue", async () => {
    const { db, queueService } = makeServices();

    const first = await queueService.enqueueApprovedItem("item-local", "telegram");
    const second = await queueService.enqueueApprovedItem("item-local", "telegram");

    expect(first.alreadyQueued).toBe(false);
    expect(second.alreadyQueued).toBe(true);
    expect(first.queueItem.id).toBe(second.queueItem.id);
    expect(db.publishQueue).toHaveLength(1);
    expect(firstItem(db).status).toBe("queued_for_publish");
  });

  it("prevents publishing outside allowed hours", async () => {
    const db = new FakeDb();
    const queueService = new PublishQueueService(new PublishQueueRepository(db), new ItemsRepository(db), {
      minMinutesBetweenPosts: 30,
      allowedPublishHours: [9],
      timezone: "UTC",
      maxPostsPerDay: 8
    });
    await queueService.enqueueApprovedItem("item-local", "telegram");

    const next = await queueService.getNextPublishableItem("telegram", new Date("2026-05-22T08:00:00.000Z"));

    expect(next).toBeNull();
  });
});

describe("PublishingService", () => {
  it("publishes the next queued Telegram item through the publisher and stores final metadata", async () => {
    const { db, queueService, outputsRepository, publishingService, publisher } = makeServices();
    await queueService.enqueueApprovedItem("item-local", "telegram");
    await outputsRepository.saveGeneratedOutput({
      itemId: "item-local",
      target: "telegram",
      promptId: "telegram_curation_v1",
      promptVersion: "1.0.0",
      model: "mock-model",
      output: {
        language_detected: "fa",
        telegram_caption_fa: "کپشن نهایی",
        summary_fa: "خلاصه نهایی",
        hashtags: ["#AI"],
        risk_flags: [],
        relevance_score: 0.9,
        quality_score: 0.8
      }
    });

    const result = await publishingService.publishNextTelegram({
      finalChatId: "final-chat-local",
      now: new Date("2026-05-22T08:00:00.000Z"),
      publishNow: true
    });

    expect(result.outcome).toBe("published");
    expect(publisher.published).toHaveLength(1);
    expect(firstPublishedMessage(publisher).text).toContain("کپشن نهایی");
    expect(firstPublishQueueRow(db).status).toBe("published");
    expect(firstPublishQueueRow(db).final_message_id).toBe("final-message-local");
    expect(firstItem(db).status).toBe("published_telegram");
  });

  it("marks the queue item as failed when final Telegram publishing fails", async () => {
    const db = new FakeDb();
    const itemsRepository = new ItemsRepository(db);
    const queueRepository = new PublishQueueRepository(db);
    const queueService = new PublishQueueService(queueRepository, itemsRepository);
    const publishingService = new PublishingService(queueService, new OutputsRepository(db), itemsRepository, new FailingTelegramPublisher());
    await queueService.enqueueApprovedItem("item-local", "telegram");

    const result = await publishingService.publishNextTelegram({
      finalChatId: "final-chat-local",
      publishNow: true
    });

    expect(result.outcome).toBe("failed");
    expect(firstPublishQueueRow(db).status).toBe("failed");
    expect(firstPublishQueueRow(db).last_error).toBe("telegram publish failed");
  });
});
