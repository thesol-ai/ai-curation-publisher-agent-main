import { describe, expect, it } from "vitest";
import type { D1DatabaseLike, D1PreparedStatementLike, D1Result, D1RunResult, D1Value } from "@curator/db";
import { readTelegramTopicWorkflowSummary } from "./status";
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
    if (this.query.includes("COUNT(*) AS count FROM telegram_routes")) {
      const count = this.query.includes("enabled = 1") ? this.db.routes.filter((route) => route.enabled === 1).length : this.db.routes.length;
      return { count } as T;
    }
    if (this.query.includes("COUNT(*) AS count FROM telegram_route_outputs")) {
      const count = this.query.includes("enabled = 1") ? this.db.outputs.filter((output) => output.enabled === 1).length : this.db.outputs.length;
      return { count } as T;
    }
    return null;
  }

  async all<T = unknown>(): Promise<D1Result<T>> {
    if (this.query.includes("FROM telegram_routes")) {
      return { success: true, results: this.db.routes as T[] };
    }
    if (this.query.includes("FROM telegram_route_outputs")) {
      return { success: true, results: this.db.outputs as T[] };
    }
    return { success: true, results: [] };
  }

  async run(): Promise<D1RunResult> {
    return { success: true, changes: 0 };
  }
}

class FakeDb implements D1DatabaseLike {
  readonly routes: RouteRow[] = [
    {
      id: "crypto",
      category: "crypto",
      source_chat_id: "-1001234567890",
      source_thread_id: 101,
      prompt_profile: "crypto_editorial",
      enabled: 1,
      created_at: "2026-05-25T00:00:00.000Z",
      updated_at: "2026-05-25T00:00:00.000Z"
    }
  ];

  readonly outputs: OutputRow[] = [
    {
      id: "crypto_fa",
      route_id: "crypto",
      language: "fa",
      review_chat_id: "-1001234567890",
      review_thread_id: 201,
      final_chat_id: "@crypto_fa",
      final_thread_id: null,
      enabled: 1,
      created_at: "2026-05-25T00:00:00.000Z",
      updated_at: "2026-05-25T00:00:00.000Z"
    }
  ];

  prepare(query: string): D1PreparedStatementLike {
    return new FakeStatement(this, query);
  }
}

function makeEnv(): Env {
  return {
    DB: new FakeDb() as unknown as D1Database,
    TELEGRAM_BOT_TOKEN: "configured-token"
  };
}

describe("readTelegramTopicWorkflowSummary", () => {
  it("keeps media mode and sendMediaGroup support explicit", async () => {
    const summary = await readTelegramTopicWorkflowSummary(makeEnv());

    expect(summary).toMatchObject({
      routeManagerReady: true,
      topicWorkflowConfigured: true,
      mediaMode: "telegram_file_id_reuse",
      sendMediaGroupSupported: true,
      wordpressOptional: true
    });
    expect(summary.warnings).toEqual(expect.arrayContaining([
      "External media processor is disabled. Telegram-origin file_id reuse remains active."
    ]));
  });
});
