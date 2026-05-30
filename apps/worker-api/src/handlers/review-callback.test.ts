import { describe, expect, it } from "vitest";
import { parseTelegramUpdate } from "@curator/telegram";
import { handleReviewCallback } from "./review-callback";
import type { D1DatabaseLike, D1PreparedStatementLike, D1RunResult, D1Result, D1Value } from "@curator/db";
import type { ParsedTelegramCallback, TelegramReviewAction } from "@curator/telegram";

type RunCall = {
  query: string;
  values: D1Value[];
};

type PublishQueueRow = {
  id: string;
  item_id: string;
  target: string;
  status: string;
  scheduled_for: string | null;
  attempt_count: number;
  last_error: string | null;
  final_message_id: string | null;
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
    if (this.query.includes("FROM publish_queue")) {
      const itemId = String(this.values[0]);
      const target = String(this.values[1]);
      return (this.db.publishQueue.find((row) => row.item_id === itemId && row.target === target && (row.status === "pending" || row.status === "scheduled")) as T | undefined) ?? null;
    }

    return null;
  }

  async all<T = unknown>(): Promise<D1Result<T>> {
    return { success: true, results: [] };
  }

  async run(): Promise<D1RunResult> {
    this.db.runCalls.push({ query: this.query, values: this.values });

    if (this.query.includes("INSERT INTO publish_queue")) {
      this.db.publishQueue.push({
        id: String(this.values[0]),
        item_id: String(this.values[1]),
        target: String(this.values[2]),
        status: String(this.values[3]),
        scheduled_for: this.values[4] === null ? null : String(this.values[4]),
        attempt_count: Number(this.values[5]),
        last_error: null,
        final_message_id: null,
        created_at: String(this.values[6]),
        updated_at: String(this.values[7])
      });
    }

    return { success: true, changes: 1 };
  }
}

class FakeDb implements D1DatabaseLike {
  runCalls: RunCall[] = [];
  publishQueue: PublishQueueRow[] = [];

  prepare(query: string): D1PreparedStatementLike {
    return new FakeStatement(this, query);
  }
}

function makeCallback(action: TelegramReviewAction): ParsedTelegramCallback {
  const parsed = parseTelegramUpdate({
    update_id: 55,
    callback_query: {
      id: `callback-${action}`,
      from: { id: 66, first_name: "Reviewer" },
      message: { message_id: 77, chat: { id: 88, type: "private" } },
      data: `review:${action}:item_local`
    }
  });

  if (parsed.kind !== "callback") {
    throw new Error("Expected callback");
  }

  return parsed;
}

describe("handleReviewCallback", () => {
  it("logs send callbacks, marks the item approved, and enqueues publishing", async () => {
    const db = new FakeDb();
    const result = await handleReviewCallback(makeCallback("send"), db);

    expect(result.action).toBe("send");
    expect(result.resultingStatus).toBe("queued_for_publish");
    expect(result.publishQueueStatus).toBe("pending");
    expect(result.publishQueueId).toMatch(/^publish_/);
    expect(result.statusResponse).toEqual({
      itemId: "item_local",
      action: "send",
      status: "queued_for_publish",
      publishStatus: "pending",
      message: "Send action approved the item and queued it for publishing. Final publishing is not triggered by the callback.",
      finalPublishingTriggered: false,
      editStubbed: false
    });
    expect(db.publishQueue).toHaveLength(1);
    expect(db.runCalls.some((call) => call.query.includes("INSERT INTO review_actions"))).toBe(true);
    expect(db.runCalls.some((call) => call.query.includes("INSERT INTO publish_queue"))).toBe(true);
    expect(db.runCalls.filter((call) => call.query.includes("UPDATE items SET status"))).toHaveLength(2);
  });

  it("logs cancel callbacks and does not enqueue publishing", async () => {
    const db = new FakeDb();
    const result = await handleReviewCallback(makeCallback("cancel"), db);

    expect(result.action).toBe("cancel");
    expect(result.resultingStatus).toBe("cancelled");
    expect(result.statusResponse.status).toBe("cancelled");
    expect(result.statusResponse.finalPublishingTriggered).toBe(false);
    expect(db.publishQueue).toHaveLength(0);
    expect(db.runCalls.some((call) => call.query.includes("INSERT INTO review_actions"))).toBe(true);
    expect(db.runCalls.some((call) => call.query.includes("INSERT INTO publish_queue"))).toBe(false);
  });

  it("logs status callbacks and returns structured status without changing item state", async () => {
    const db = new FakeDb();
    const result = await handleReviewCallback(makeCallback("status"), db);

    expect(result.action).toBe("status");
    expect(result.resultingStatus).toBe("sent_to_review");
    expect(result.statusResponse).toEqual({
      itemId: "item_local",
      action: "status",
      status: "sent_to_review",
      message: "Status action returned current review and publishing routing state.",
      finalPublishingTriggered: false,
      editStubbed: false
    });
    expect(db.publishQueue).toHaveLength(0);
    expect(db.runCalls.some((call) => call.query.includes("INSERT INTO review_actions"))).toBe(true);
    expect(db.runCalls.some((call) => call.query.includes("UPDATE items SET status"))).toBe(false);
  });

  it("logs edit callbacks as an acknowledged stub", async () => {
    const db = new FakeDb();
    const result = await handleReviewCallback(makeCallback("edit"), db);

    expect(result.action).toBe("edit");
    expect(result.resultingStatus).toBe("sent_to_review");
    expect(result.statusResponse.editStubbed).toBe(true);
    expect(result.statusResponse.finalPublishingTriggered).toBe(false);
    expect(result.statusResponse.message).toContain("stubbed");
    expect(db.publishQueue).toHaveLength(0);
    expect(db.runCalls.some((call) => call.query.includes("INSERT INTO review_actions"))).toBe(true);
    expect(db.runCalls.some((call) => call.query.includes("UPDATE items SET status"))).toBe(false);
  });
});
