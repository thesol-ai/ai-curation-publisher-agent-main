import { afterEach, describe, expect, it, vi } from "vitest";
import { handleTelegramOutputCallback } from "./callback-orchestrator";
import type { D1DatabaseLike, D1PreparedStatementLike, D1Result, D1RunResult, D1Value } from "@curator/db";
import type { ParsedTelegramOutputCallback } from "@curator/telegram";
import { MockTelegramClient } from "@curator/telegram";
import type { Env } from "../types";

type OutputRow = {
  id: string;
  item_id: string;
  route_id: string;
  route_output_id: string;
  language: string;
  status: string;
  prompt_profile: string;
  model: string | null;
  output_json: string;
  input_tokens: number | null;
  output_tokens: number | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
};

type RouteOutputRow = {
  id: string;
  route_id: string;
  language: string;
  review_chat_id: string;
  review_thread_id: number;
  final_chat_id: string;
  final_thread_id: number | null;
  enabled: number;
  publish_enabled?: number | null;
  publish_mode?: string | null;
  timezone?: string | null;
  allowed_publish_windows_json?: string | null;
  minimum_gap_minutes?: number | null;
  max_posts_per_hour?: number | null;
  max_posts_per_day?: number | null;
  queue_priority?: number | null;
  created_at: string;
  updated_at: string;
};

type QueueRow = {
  id: string;
  item_id: string;
  generated_output_id: string;
  route_id: string;
  route_output_id: string;
  language: string;
  final_chat_id: string;
  final_thread_id: number | null;
  status: string;
  scheduled_for: string | null;
  priority: number;
  attempt_count: number;
  last_error: string | null;
  final_message_id: string | null;
  created_at: string;
  updated_at: string;
};


type ReviewMessageRow = {
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

type MediaRow = {
  id: string;
  item_id: string;
  kind: string;
  status: string;
  source_url: string;
  canonical_url: string | null;
  media_url_hash: string | null;
  r2_key: string | null;
  public_url: string | null;
  size_bytes: number | null;
  mime_type: string | null;
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
  error_message: string | null;
  telegram_file_id: string | null;
  telegram_file_unique_id: string | null;
  telegram_media_group_id: string | null;
  telegram_file_type: string | null;
  telegram_mime_type: string | null;
  telegram_file_size: number | null;
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
    if (this.query.includes("FROM telegram_generated_outputs WHERE id")) {
      return (this.db.outputs.get(String(this.values[0])) as T | undefined) ?? null;
    }
    if (this.query.includes("FROM telegram_route_outputs WHERE id")) {
      return (this.db.routeOutputs.get(String(this.values[0])) as T | undefined) ?? null;
    }
    if (this.query.includes("FROM telegram_publish_queue WHERE generated_output_id")) {
      const row = Array.from(this.db.queue.values()).find((entry) => entry.generated_output_id === String(this.values[0]));
      return (row as T | undefined) ?? null;
    }
    if (this.query.includes("FROM telegram_review_messages WHERE generated_output_id")) {
      const row = Array.from(this.db.reviewMessages.values()).find((entry) => entry.generated_output_id === String(this.values[0]));
      return (row as T | undefined) ?? null;
    }
    return null;
  }

  async all<T = unknown>(): Promise<D1Result<T>> {
    if (this.query.includes("FROM media_assets WHERE item_id")) {
      const itemId = String(this.values[0]);
      return { success: true, results: this.db.media.filter((entry) => entry.item_id === itemId) as T[] };
    }
    return { success: true, results: [] };
  }

  async run(): Promise<D1RunResult> {
    if (this.query.includes("UPDATE telegram_generated_outputs SET status")) {
      const status = String(this.values[0]);
      const errorMessage = this.values[1] === null ? null : String(this.values[1]);
      const id = String(this.values[2]);
      const row = this.db.outputs.get(id);
      if (row) {
        row.status = status;
        row.error_message = errorMessage;
      }
    }

    if (this.query.includes("INSERT INTO telegram_publish_queue")) {
      const row: QueueRow = {
        id: String(this.values[0]),
        item_id: String(this.values[1]),
        generated_output_id: String(this.values[2]),
        route_id: String(this.values[3]),
        route_output_id: String(this.values[4]),
        language: String(this.values[5]),
        final_chat_id: String(this.values[6]),
        final_thread_id: this.values[7] === null ? null : Number(this.values[7]),
        status: String(this.values[8]),
        scheduled_for: this.values[9] === null ? null : String(this.values[9]),
        priority: Number(this.values[10]),
        attempt_count: Number(this.values[11]),
        last_error: null,
        final_message_id: null,
        created_at: String(this.values[12]),
        updated_at: String(this.values[13])
      };
      this.db.queue.set(row.id, row);
    }

    if (this.query.includes("UPDATE telegram_publish_queue SET status = 'publishing'")) {
      const row = this.db.queue.get(String(this.values[0]));
      if (row) {
        row.status = "publishing";
        row.attempt_count += 1;
      }
    }

    if (this.query.includes("UPDATE telegram_publish_queue SET status = 'published'")) {
      const row = this.db.queue.get(String(this.values[1]));
      if (row) {
        row.status = "published";
        row.final_message_id = String(this.values[0]);
      }
    }

    if (this.query.includes("UPDATE telegram_publish_queue SET status = 'failed'")) {
      const row = this.db.queue.get(String(this.values[1]));
      if (row) {
        row.status = "failed";
        row.last_error = String(this.values[0]);
      }
    }

    return { success: true, changes: 1 };
  }
}

class FakeDb implements D1DatabaseLike {
  readonly outputs = new Map<string, OutputRow>();
  readonly routeOutputs = new Map<string, RouteOutputRow>();
  readonly queue = new Map<string, QueueRow>();
  readonly reviewMessages = new Map<string, ReviewMessageRow>();
  readonly media: MediaRow[] = [];

  prepare(query: string): D1PreparedStatementLike {
    return new FakeStatement(this, query);
  }
}

function makeDb(): FakeDb {
  const db = new FakeDb();
  db.outputs.set("tgout_local", {
    id: "tgout_local",
    item_id: "item_local",
    route_id: "crypto",
    route_output_id: "crypto_fa",
    language: "fa",
    status: "ready_for_review",
    prompt_profile: "crypto_editorial",
    model: "mock",
    output_json: JSON.stringify({ language: "fa", caption: "Final caption", hashtags: [], riskFlags: [], sourceAttributionText: "Source" }),
    input_tokens: null,
    output_tokens: null,
    error_message: null,
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString()
  });
  db.routeOutputs.set("crypto_fa", {
    id: "crypto_fa",
    route_id: "crypto",
    language: "fa",
    review_chat_id: "review-chat",
    review_thread_id: 201,
    final_chat_id: "final-chat",
    final_thread_id: null,
    enabled: 1,
    publish_enabled: 1,
    publish_mode: "scheduled",
    timezone: "UTC",
    allowed_publish_windows_json: "[]",
    minimum_gap_minutes: 10,
    max_posts_per_hour: 4,
    max_posts_per_day: 24,
    queue_priority: 0,
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString()
  });
  db.reviewMessages.set("review_local", {
    id: "review_local",
    generated_output_id: "tgout_local",
    item_id: "item_local",
    route_id: "crypto",
    route_output_id: "crypto_fa",
    language: "fa",
    chat_id: "review-chat",
    thread_id: 201,
    message_id: "review-message-1",
    status: "sent",
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString()
  });
  return db;
}

function makeEnv(db: FakeDb, finalPublishEnabled = false): Env & { TELEGRAM_FINAL_PUBLISH_ENABLED?: string } {
  return {
    DB: db as unknown as D1Database,
    TELEGRAM_BOT_TOKEN: "configured-token",
    ...(finalPublishEnabled ? { TELEGRAM_FINAL_PUBLISH_ENABLED: "true" } : {})
  };
}

function makeParsed(action: ParsedTelegramOutputCallback["action"] = "send"): ParsedTelegramOutputCallback {
  return {
    kind: "output_callback",
    callback: { id: "callback-local", from: { id: 1 }, data: `tgout:${action}:tgout_local` },
    reviewerId: "1",
    token: "tgout_local",
    action
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("handleTelegramOutputCallback", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("queues only when final publishing is disabled", async () => {
    const db = makeDb();
    const telegramClient = new MockTelegramClient();
    const result = await handleTelegramOutputCallback(makeParsed(), makeEnv(db, false), telegramClient);

    expect(result).toMatchObject({ ok: true, status: "scheduled", publishQueueStatus: "scheduled", finalPublishingTriggered: false });
    expect(Array.from(db.queue.values())[0]?.status).toBe("scheduled");
    expect(db.outputs.get("tgout_local")?.status).toBe("scheduled");
    expect(telegramClient.answeredCallbacks[0]?.text).toContain("Scheduled for");
    expect(telegramClient.editedReviewMessages[0]?.replyMarkup?.inline_keyboard[0]?.[0]?.text).toContain("Scheduled");
  });

  it("marks the review keyboard as waiting for an edit reply", async () => {
    const db = makeDb();
    const telegramClient = new MockTelegramClient();

    const result = await handleTelegramOutputCallback(makeParsed("edit"), makeEnv(db, false), telegramClient);

    expect(result).toMatchObject({ ok: true, action: "edit", status: "ready_for_review", finalPublishingTriggered: false });
    expect(telegramClient.answeredCallbacks[0]?.text).toContain("Reply to this review message");
    expect(telegramClient.editedReviewMessages[0]?.replyMarkup?.inline_keyboard.flat().map((button) => button.text)).toContain("✏️ Waiting for reply");
    expect(db.outputs.get("tgout_local")?.status).toBe("ready_for_review");
  });

  it("publishes and marks output plus queue as published when enabled", async () => {
    const db = makeDb();
    db.routeOutputs.get("crypto_fa")!.publish_mode = "immediate";
    const telegramClient = new MockTelegramClient();
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ ok: true, result: { message_id: 900, chat: { id: "final-chat" }, text: "Final caption" } })));

    const result = await handleTelegramOutputCallback(makeParsed(), makeEnv(db, true), telegramClient);

    expect(result).toMatchObject({ ok: true, status: "published", publishQueueStatus: "published", finalPublishingTriggered: true });
    expect(db.outputs.get("tgout_local")?.status).toBe("published");
    expect(Array.from(db.queue.values())[0]).toMatchObject({ status: "published", final_message_id: "900" });
    expect(telegramClient.editedReviewMessages.at(-1)?.replyMarkup?.inline_keyboard[0]?.[0]?.text).toContain("Published");
  });

  it("marks output and queue as failed with redacted error when final publishing fails", async () => {
    const db = makeDb();
    db.routeOutputs.get("crypto_fa")!.publish_mode = "immediate";
    const telegramClient = new MockTelegramClient();
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ ok: false, description: "remote failure with configured-token" }, 401)));

    const result = await handleTelegramOutputCallback(makeParsed(), makeEnv(db, true), telegramClient);

    expect(result).toMatchObject({ ok: false, status: "failed", publishQueueStatus: "failed", finalPublishingTriggered: true, message: "Telegram Bot API returned an error." });
    expect(db.outputs.get("tgout_local")?.status).toBe("failed");
    expect(db.outputs.get("tgout_local")?.error_message).toBe("Telegram Bot API returned an error.");
    expect(Array.from(db.queue.values())[0]).toMatchObject({ status: "failed", last_error: "Telegram Bot API returned an error." });
    expect(telegramClient.editedReviewMessages.at(-1)?.replyMarkup?.inline_keyboard[0]?.[0]?.text).toContain("Failed");
  });

  it("does not enqueue duplicates when Send is pressed repeatedly", async () => {
    const db = makeDb();
    const telegramClient = new MockTelegramClient();

    const first = await handleTelegramOutputCallback(makeParsed(), makeEnv(db, false), telegramClient);
    const second = await handleTelegramOutputCallback(makeParsed(), makeEnv(db, false), telegramClient);

    expect(first.ok).toBe(true);
    expect(second).toMatchObject({ ok: true, publishQueueStatus: "scheduled", finalPublishingTriggered: false });
    expect(Array.from(db.queue.values())).toHaveLength(1);
    expect(telegramClient.answeredCallbacks[1]?.text).toContain("Already queued");
  });

});
