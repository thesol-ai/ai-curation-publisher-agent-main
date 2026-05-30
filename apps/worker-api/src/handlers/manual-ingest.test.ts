import { describe, expect, it } from "vitest";
import { parseTelegramUpdate } from "@curator/telegram";
import { MockTelegramClient } from "@curator/telegram";
import { handleManualIngest } from "./manual-ingest";
import type { D1DatabaseLike, D1PreparedStatementLike, D1RunResult, D1Result, D1Value } from "@curator/db";
import type { DedupeKeyType, Item } from "@curator/core";
import type { ParsedManualTelegramMessage } from "@curator/telegram";

type InsertedRow = {
  query: string;
  values: D1Value[];
};

type StoredDedupeKey = {
  id: string;
  item_id: string;
  key_type: DedupeKeyType | string;
  key_value: string;
  created_at: string;
};

class FakeStatement implements D1PreparedStatementLike {
  private values: D1Value[] = [];

  constructor(private readonly db: FakeDb, private readonly query: string) {}

  bind(...values: D1Value[]): D1PreparedStatementLike {
    this.values = values;
    return this;
  }

  async first<T = unknown>(): Promise<T | null> {
    const lookupValue = String(this.values[0] ?? "");

    if (this.query.includes("FROM dedupe_keys")) {
      const keyType = String(this.values[0]);
      const keyValue = String(this.values[1]);
      return (this.db.dedupeKeys.find((key) => key.key_type === keyType && key.key_value === keyValue) as T | undefined) ?? null;
    }

    if (this.query.includes("FROM items WHERE source_post_id")) {
      return (this.db.items.find((item) => item.sourcePostId === lookupValue) as T | undefined) ?? null;
    }

    if (this.query.includes("FROM items WHERE canonical_url_hash")) {
      return (this.db.items.find((item) => item.canonicalUrlHash === lookupValue) as T | undefined) ?? null;
    }

    if (this.query.includes("FROM items WHERE normalized_text_hash")) {
      return (this.db.items.find((item) => item.normalizedTextHash === lookupValue) as T | undefined) ?? null;
    }

    return null;
  }

  async all<T = unknown>(): Promise<D1Result<T>> {
    return { success: true, results: [] };
  }

  async run(): Promise<D1RunResult> {
    this.db.insertedRows.push({ query: this.query, values: this.values });

    if (this.query.includes("INSERT INTO items")) {
      const item: Item = {
        id: String(this.values[0]),
        sourceId: String(this.values[1]),
        provider: String(this.values[2]),
        platform: this.values[3] as Item["platform"],
        sourceType: this.values[4] as Item["sourceType"],
        ...(this.values[5] === null ? {} : { sourcePostId: String(this.values[5]) }),
        canonicalUrl: String(this.values[6]),
        canonicalUrlHash: String(this.values[7]),
        ...(this.values[8] === null ? {} : { normalizedTextHash: String(this.values[8]) }),
        status: this.values[9] as Item["status"],
        ...(this.values[10] === null ? {} : { publishedAt: String(this.values[10]) }),
        ...(this.values[11] === null ? {} : { authorHandle: String(this.values[11]) }),
        ...(this.values[12] === null ? {} : { text: String(this.values[12]) }),
        links: JSON.parse(String(this.values[13])) as string[],
        rawPayload: JSON.parse(String(this.values[14])) as Record<string, unknown>,
        createdAt: String(this.values[15]),
        updatedAt: String(this.values[16])
      };

      this.db.items.push(item);
    }

    if (this.query.includes("UPDATE items SET status")) {
      const status = String(this.values[0]) as Item["status"];
      const itemId = String(this.values[1]);
      const item = this.db.items.find((candidate) => candidate.id === itemId);

      if (item) {
        item.status = status;
      }
    }

    if (this.query.includes("INSERT OR IGNORE INTO dedupe_keys")) {
      const row: StoredDedupeKey = {
        id: String(this.values[0]),
        item_id: String(this.values[1]),
        key_type: String(this.values[2]),
        key_value: String(this.values[3]),
        created_at: new Date().toISOString()
      };

      if (!this.db.dedupeKeys.some((key) => key.key_type === row.key_type && key.key_value === row.key_value)) {
        this.db.dedupeKeys.push(row);
      }
    }

    return { success: true, changes: 1 };
  }
}

class FakeDb implements D1DatabaseLike {
  insertedRows: InsertedRow[] = [];
  items: Item[] = [];
  dedupeKeys: StoredDedupeKey[] = [];

  prepare(query: string): D1PreparedStatementLike {
    return new FakeStatement(this, query);
  }
}

function requireManualMessage(update: ReturnType<typeof parseTelegramUpdate>): ParsedManualTelegramMessage {
  if (update.kind !== "manual_message") {
    throw new Error("Expected manual_message");
  }

  return update;
}

function makeInvalidManualMessage(): ParsedManualTelegramMessage {
  return {
    kind: "manual_message",
    updateId: 901,
    reviewerId: "902",
    chatId: "904",
    messageId: 903,
    text: " ",
    urls: [],
    media: [],
    message: {
      message_id: 903,
      from: { id: 902, first_name: "Reviewer" },
      chat: { id: 904, type: "private" },
      text: " "
    }
  };
}

describe("handleManualIngest", () => {
  it("passes valid manual input through the gate, sends review message, and stores metadata", async () => {
    const parsed = requireManualMessage(parseTelegramUpdate({
      update_id: 11,
      message: {
        message_id: 22,
        from: { id: 33, first_name: "Reviewer" },
        chat: { id: 44, type: "private" },
        text: "Manual item https://source.local/post"
      }
    }));

    const db = new FakeDb();
    const telegramClient = new MockTelegramClient();
    const result = await handleManualIngest(parsed, db, { reviewChatId: "review-chat-local", telegramClient });

    expect(result.status).toBe("created");
    expect(result.lifecycleStatus).toBe("queued_for_ai");
    expect(result.validationIssues).toEqual([]);
    expect(result.costControl).toEqual({
      entersAiQueue: true,
      entersMediaQueue: false,
      entersReviewQueue: false
    });
    expect(result.itemId).toMatch(/^item_/);
    expect(result.reviewChatId).toBe("review-chat-local");
    expect(result.reviewMessageId).toBe("mock_telegram_review_1");
    expect(result.reviewDraft?.text).toContain("کپشن");
    expect(result.reviewDraft?.reply_markup.inline_keyboard.flat().map((button) => button.text)).toContain("Send");
    expect(telegramClient.sentReviewMessages).toHaveLength(1);
    expect(telegramClient.sentReviewMessages[0]?.text).toContain("Persian caption");
    expect(db.insertedRows.some((row) => row.query.includes("INSERT OR IGNORE INTO sources"))).toBe(true);
    expect(db.insertedRows.some((row) => row.query.includes("INSERT INTO items"))).toBe(true);
    expect(db.insertedRows.some((row) => row.query.includes("INSERT OR REPLACE INTO review_messages"))).toBe(true);
  });

  it("does not insert a second item or send a second review message for duplicate manual URL input", async () => {
    const firstParsed = requireManualMessage(parseTelegramUpdate({
      update_id: 101,
      message: {
        message_id: 201,
        from: { id: 301, first_name: "Reviewer" },
        chat: { id: 401, type: "private" },
        text: "First review https://source.local/reused-post"
      }
    }));

    const secondParsed = requireManualMessage(parseTelegramUpdate({
      update_id: 102,
      message: {
        message_id: 202,
        from: { id: 301, first_name: "Reviewer" },
        chat: { id: 401, type: "private" },
        text: "Second review https://source.local/reused-post"
      }
    }));

    const db = new FakeDb();
    const telegramClient = new MockTelegramClient();
    const firstResult = await handleManualIngest(firstParsed, db, { reviewChatId: "review-chat-local", telegramClient });
    const secondResult = await handleManualIngest(secondParsed, db, { reviewChatId: "review-chat-local", telegramClient });

    expect(firstResult.status).toBe("created");
    expect(secondResult.status).toBe("duplicate");
    expect(secondResult.lifecycleStatus).toBe("duplicate_skipped");
    expect(secondResult.costControl).toEqual({
      entersAiQueue: false,
      entersMediaQueue: false,
      entersReviewQueue: false
    });
    expect(secondResult.itemId).toBe(firstResult.itemId);
    expect(secondResult.duplicateOfItemId).toBe(firstResult.itemId);
    expect(secondResult.reviewDraft).toBeUndefined();
    expect(secondResult.reviewMessageId).toBeUndefined();
    expect(telegramClient.sentReviewMessages).toHaveLength(1);
    expect(db.insertedRows.filter((row) => row.query.includes("INSERT INTO items"))).toHaveLength(1);
    expect(db.insertedRows.filter((row) => row.query.includes("INSERT OR REPLACE INTO review_messages"))).toHaveLength(1);
  });

  it("returns duplicate behavior for equivalent text-only manual input without sending a second review", async () => {
    const firstParsed = requireManualMessage(parseTelegramUpdate({
      update_id: 111,
      message: {
        message_id: 211,
        from: { id: 311, first_name: "Reviewer" },
        chat: { id: 411, type: "private" },
        text: "Manual text only item"
      }
    }));

    const secondParsed = requireManualMessage(parseTelegramUpdate({
      update_id: 112,
      message: {
        message_id: 212,
        from: { id: 311, first_name: "Reviewer" },
        chat: { id: 411, type: "private" },
        text: " manual   text ONLY item "
      }
    }));

    const db = new FakeDb();
    const telegramClient = new MockTelegramClient();
    const firstResult = await handleManualIngest(firstParsed, db, { reviewChatId: "review-chat-local", telegramClient });
    const secondResult = await handleManualIngest(secondParsed, db, { reviewChatId: "review-chat-local", telegramClient });

    expect(firstResult.status).toBe("created");
    expect(secondResult.status).toBe("duplicate");
    expect(secondResult.lifecycleStatus).toBe("duplicate_skipped");
    expect(secondResult.costControl.entersAiQueue).toBe(false);
    expect(secondResult.costControl.entersMediaQueue).toBe(false);
    expect(secondResult.costControl.entersReviewQueue).toBe(false);
    expect(secondResult.itemId).toBe(firstResult.itemId);
    expect(telegramClient.sentReviewMessages).toHaveLength(1);
    expect(db.insertedRows.filter((row) => row.query.includes("INSERT INTO items"))).toHaveLength(1);
    expect(db.insertedRows.filter((row) => row.query.includes("INSERT OR REPLACE INTO review_messages"))).toHaveLength(1);
  });

  it("returns invalid behavior without sending review metadata", async () => {
    const db = new FakeDb();
    const telegramClient = new MockTelegramClient();
    const result = await handleManualIngest(makeInvalidManualMessage(), db, { reviewChatId: "review-chat-local", telegramClient });

    expect(result.status).toBe("invalid");
    expect(result.lifecycleStatus).toBe("invalid");
    expect(result.validationIssues.map((issue) => issue.code)).toContain("missing_content");
    expect(result.costControl).toEqual({
      entersAiQueue: false,
      entersMediaQueue: false,
      entersReviewQueue: false
    });
    expect(result.reviewDraft).toBeUndefined();
    expect(result.reviewMessageId).toBeUndefined();
    expect(telegramClient.sentReviewMessages).toHaveLength(0);
    expect(db.insertedRows.filter((row) => row.query.includes("INSERT INTO items"))).toHaveLength(0);
    expect(db.insertedRows.filter((row) => row.query.includes("INSERT OR REPLACE INTO review_messages"))).toHaveLength(0);
  });
});
