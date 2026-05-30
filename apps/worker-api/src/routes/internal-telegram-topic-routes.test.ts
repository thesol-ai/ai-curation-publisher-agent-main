import { describe, expect, it } from "vitest";
import type { D1DatabaseLike, D1PreparedStatementLike, D1Result, D1RunResult, D1Value } from "@curator/db";
import { handleInternalTelegramTopicRoutes } from "./internal-telegram-topic-routes";
import { handleInternalTelegramOutputsRecent } from "./internal-telegram-outputs-recent";
import type { Env } from "../types";

type RouteRow = {
  id: string;
  category: string;
  source_chat_id: string;
  source_thread_id: number;
  prompt_profile: string;
  enabled: number;
  created_at: string;
  updated_at: string;
};

type OutputRow = {
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
  signature_enabled?: number | null;
  signature_text?: string | null;
  signature_channel_handle?: string | null;
  signature_position?: string | null;
  created_at: string;
  updated_at: string;
};

type RecentOutputRow = {
  id: string;
  item_id: string;
  route_id: string;
  route_output_id: string;
  language: string;
  status: string;
  error_message: string | null;
  updated_at: string;
  category: string | null;
  final_chat_id: string | null;
  queue_status: string | null;
  queue_error: string | null;
};

class FakeStatement implements D1PreparedStatementLike {
  private values: D1Value[] = [];

  constructor(private readonly db: FakeDb, private readonly query: string) {}

  bind(...values: D1Value[]): D1PreparedStatementLike {
    this.values = values;
    return this;
  }

  async first<T = unknown>(): Promise<T | null> {
    if (this.query.includes("COUNT(*) AS count FROM telegram_routes")) {
      const count = this.query.includes("enabled = 1") ? this.db.routes.filter((route) => route.enabled === 1).length : this.db.routes.length;
      return { count } as T;
    }
    if (this.query.includes("COUNT(*) AS count FROM telegram_route_outputs")) {
      const count = this.query.includes("enabled = 1") ? this.db.outputs.filter((output) => output.enabled === 1).length : this.db.outputs.length;
      return { count } as T;
    }
    if (this.query.includes("FROM telegram_routes WHERE id")) {
      return (this.db.routes.find((route) => route.id === String(this.values[0])) as T | undefined) ?? null;
    }
    if (this.query.includes("FROM telegram_routes WHERE source_chat_id")) {
      return (this.db.routes.find((route) => route.source_chat_id === String(this.values[0]) && route.source_thread_id === Number(this.values[1])) as T | undefined) ?? null;
    }
    if (this.query.includes("FROM telegram_route_outputs WHERE id")) {
      return (this.db.outputs.find((output) => output.id === String(this.values[0])) as T | undefined) ?? null;
    }
    return null;
  }

  async all<T = unknown>(): Promise<D1Result<T>> {
    if (this.query.includes("FROM telegram_generated_outputs")) {
      return { success: true, results: this.db.recentOutputs as T[] };
    }
    if (this.query.includes("FROM telegram_routes")) {
      return { success: true, results: this.db.routes as T[] };
    }
    if (this.query.includes("FROM telegram_route_outputs")) {
      return { success: true, results: this.db.outputs as T[] };
    }
    return { success: true, results: [] };
  }

  async run(): Promise<D1RunResult> {
    if (this.query.includes("INSERT INTO telegram_routes")) {
      const row: RouteRow = {
        id: String(this.values[0]),
        category: String(this.values[1]),
        source_chat_id: String(this.values[2]),
        source_thread_id: Number(this.values[3]),
        prompt_profile: String(this.values[4]),
        enabled: Number(this.values[5]),
        created_at: String(this.values[6]),
        updated_at: String(this.values[7])
      };
      this.db.routes = [row, ...this.db.routes.filter((route) => route.id !== row.id)];
    }
    if (this.query.includes("INSERT INTO telegram_route_outputs")) {
      const row: OutputRow = {
        id: String(this.values[0]),
        route_id: String(this.values[1]),
        language: String(this.values[2]),
        review_chat_id: String(this.values[3]),
        review_thread_id: Number(this.values[4]),
        final_chat_id: String(this.values[5]),
        final_thread_id: this.values[6] === null ? null : Number(this.values[6]),
        enabled: Number(this.values[7]),
        publish_enabled: Number(this.values[8]),
        publish_mode: String(this.values[9]),
        timezone: String(this.values[10]),
        allowed_publish_windows_json: String(this.values[11]),
        minimum_gap_minutes: Number(this.values[12]),
        max_posts_per_hour: Number(this.values[13]),
        max_posts_per_day: Number(this.values[14]),
        queue_priority: Number(this.values[15]),
        signature_enabled: Number(this.values[16]),
        signature_text: this.values[17] === null ? null : String(this.values[17]),
        signature_channel_handle: this.values[18] === null ? null : String(this.values[18]),
        signature_position: String(this.values[19]),
        created_at: String(this.values[20]),
        updated_at: String(this.values[21])
      };
      this.db.outputs = [row, ...this.db.outputs.filter((output) => output.id !== row.id)];
    }
    if (this.query.includes("UPDATE telegram_routes SET enabled = 0")) {
      const route = this.db.routes.find((entry) => entry.id === String(this.values[0]));
      if (route) route.enabled = 0;
    }
    if (this.query.includes("UPDATE telegram_route_outputs SET enabled = 0")) {
      const output = this.db.outputs.find((entry) => entry.id === String(this.values[0]));
      if (output) output.enabled = 0;
    }
    return { success: true, changes: 1 };
  }
}

class FakeDb implements D1DatabaseLike {
  routes: RouteRow[] = [];
  outputs: OutputRow[] = [];
  recentOutputs: RecentOutputRow[] = [];

  prepare(query: string): D1PreparedStatementLike {
    return new FakeStatement(this, query);
  }
}

function makeEnv(db: FakeDb): Env {
  return { DB: db as unknown as D1Database, INTERNAL_API_SECRET: "secret" };
}

function internalRequest(path: string, init: RequestInit = {}): Request {
  return new Request(`https://worker.local${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-internal-api-secret": "secret",
      ...(init.headers ?? {})
    }
  });
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  return await response.json() as Record<string, unknown>;
}

describe("internal Telegram topic route APIs", () => {
  it("requires internal auth for route listing", async () => {
    const response = await handleInternalTelegramTopicRoutes(new Request("https://worker.local/internal/telegram/topic-routes"), makeEnv(new FakeDb()));
    expect(response.status).toBe(401);
  });

  it("validates route creation input", async () => {
    const response = await handleInternalTelegramTopicRoutes(internalRequest("/internal/telegram/topic-routes", { method: "POST", body: JSON.stringify({ id: "crypto" }) }), makeEnv(new FakeDb()));
    expect(response.status).toBe(400);
    await expect(readJson(response)).resolves.toMatchObject({ error: "invalid_route" });
  });

  it("rejects duplicate source chat and topic", async () => {
    const db = new FakeDb();
    db.routes.push({ id: "crypto", category: "crypto", source_chat_id: "-1001", source_thread_id: 101, prompt_profile: "crypto_editorial", enabled: 1, created_at: "now", updated_at: "now" });
    const response = await handleInternalTelegramTopicRoutes(internalRequest("/internal/telegram/topic-routes", { method: "POST", body: JSON.stringify({ id: "design", category: "design", sourceChatId: "-1001", sourceThreadId: 101, promptProfile: "design_editorial" }) }), makeEnv(db));
    expect(response.status).toBe(400);
    await expect(readJson(response)).resolves.toMatchObject({ error: "duplicate_source_topic" });
  });

  it("adds, updates, and disables route outputs", async () => {
    const db = new FakeDb();
    db.routes.push({ id: "crypto", category: "crypto", source_chat_id: "-1001", source_thread_id: 101, prompt_profile: "crypto_editorial", enabled: 1, created_at: "now", updated_at: "now" });

    const invalid = await handleInternalTelegramTopicRoutes(internalRequest("/internal/telegram/topic-routes/crypto/outputs", { method: "POST", body: JSON.stringify({ id: "crypto_fa" }) }), makeEnv(db));
    expect(invalid.status).toBe(400);

    const invalidSignature = await handleInternalTelegramTopicRoutes(internalRequest("/internal/telegram/topic-routes/crypto/outputs", { method: "POST", body: JSON.stringify({ id: "crypto_bad", language: "fa", reviewChatId: "-1001", reviewThreadId: 201, finalChatId: "@crypto_fa", signatureEnabled: true }) }), makeEnv(db));
    expect(invalidSignature.status).toBe(400);

    const created = await handleInternalTelegramTopicRoutes(internalRequest("/internal/telegram/topic-routes/crypto/outputs", { method: "POST", body: JSON.stringify({ id: "crypto_fa", language: "fa", reviewChatId: "-1001", reviewThreadId: 201, finalChatId: "@crypto_fa", signatureEnabled: true, signatureChannelHandle: "@crypto_fa" }) }), makeEnv(db));
    expect(created.status).toBe(200);
    expect(db.outputs[0]?.id).toBe("crypto_fa");
    expect(db.outputs[0]?.signature_channel_handle).toBe("@crypto_fa");

    const updated = await handleInternalTelegramTopicRoutes(internalRequest("/internal/telegram/topic-route-outputs/crypto_fa", { method: "PUT", body: JSON.stringify({ id: "crypto_fa", language: "fa", reviewChatId: "-1001", reviewThreadId: 202, finalChatId: "@crypto_fa" }) }), makeEnv(db));
    expect(updated.status).toBe(200);

    const disabled = await handleInternalTelegramTopicRoutes(internalRequest("/internal/telegram/topic-route-outputs/crypto_fa/disable", { method: "POST", body: JSON.stringify({}) }), makeEnv(db));
    expect(disabled.status).toBe(200);
    expect(db.outputs[0]?.enabled).toBe(0);
  });

  it("disables routes and validates stored route config", async () => {
    const db = new FakeDb();
    db.routes.push({ id: "crypto", category: "crypto", source_chat_id: "-1001", source_thread_id: 101, prompt_profile: "crypto_editorial", enabled: 1, created_at: "now", updated_at: "now" });
    const disabled = await handleInternalTelegramTopicRoutes(internalRequest("/internal/telegram/topic-routes/crypto/disable", { method: "POST", body: JSON.stringify({}) }), makeEnv(db));
    expect(disabled.status).toBe(200);
    expect(db.routes[0]?.enabled).toBe(0);

    const validated = await handleInternalTelegramTopicRoutes(internalRequest("/internal/telegram/topic-routes/validate", { method: "POST", body: JSON.stringify({}) }), makeEnv(db));
    expect(validated.status).toBe(200);
    const body = await readJson(validated);
    expect(body).toMatchObject({ ok: true });
  });
});

describe("internal recent Telegram outputs API", () => {
  it("requires internal auth", async () => {
    const response = await handleInternalTelegramOutputsRecent(new Request("https://worker.local/internal/telegram/outputs/recent"), makeEnv(new FakeDb()));
    expect(response.status).toBe(401);
  });

  it("redacts token-like errors", async () => {
    const db = new FakeDb();
    db.recentOutputs.push({
      id: "tgout_1",
      item_id: "item_1",
      route_id: "crypto",
      route_output_id: "crypto_fa",
      language: "fa",
      status: "failed",
      error_message: "failed with 123456:SECRET_TOKEN",
      updated_at: "2026-05-25T00:00:00.000Z",
      category: "crypto",
      final_chat_id: "@crypto_fa",
      queue_status: "failed",
      queue_error: "failed with 123456:SECRET_TOKEN"
    });
    const response = await handleInternalTelegramOutputsRecent(internalRequest("/internal/telegram/outputs/recent?limit=20", { method: "GET" }), makeEnv(db));
    expect(response.status).toBe(200);
    const body = await readJson(response);
    expect(JSON.stringify(body)).toContain("[redacted-token]");
    expect(JSON.stringify(body)).not.toContain("SECRET_TOKEN");
  });
});
