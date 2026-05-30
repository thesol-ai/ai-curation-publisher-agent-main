import { describe, expect, it } from "vitest";
import type { D1DatabaseLike, D1PreparedStatementLike, D1Result, D1RunResult, D1Value } from "../client";
import { OutputsRepository } from "./outputs.repository";

type OutputRow = {
  id: string;
  item_id: string;
  target: "telegram" | "wordpress";
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
    if (this.query.includes("FROM outputs")) {
      const itemId = String(this.values[0]);
      const target = String(this.values[1]);
      return (this.db.rows.find((row) => row.item_id === itemId && row.target === target) as T | undefined) ?? null;
    }

    return null;
  }

  async all<T = unknown>(): Promise<D1Result<T>> {
    return { success: true, results: [] };
  }

  async run(): Promise<D1RunResult> {
    if (this.query.includes("INSERT OR REPLACE INTO outputs")) {
      const row: OutputRow = {
        id: String(this.values[0]),
        item_id: String(this.values[1]),
        target: this.values[2] as OutputRow["target"],
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

      const existingIndex = this.db.rows.findIndex((candidate) => candidate.id === row.id);
      if (existingIndex >= 0) {
        this.db.rows[existingIndex] = row;
      } else {
        this.db.rows.push(row);
      }
    }

    return { success: true, changes: 1 };
  }
}

class FakeDb implements D1DatabaseLike {
  rows: OutputRow[] = [];

  prepare(query: string): D1PreparedStatementLike {
    return new FakeStatement(this, query);
  }
}

describe("OutputsRepository", () => {
  it("stores and reads generated Telegram output", async () => {
    const repository = new OutputsRepository(new FakeDb());

    await repository.saveGeneratedOutput({
      itemId: "item-local",
      target: "telegram",
      promptId: "telegram_curation_v1",
      promptVersion: "1.0.0",
      model: "mock-telegram-curator-v1",
      output: { headline: "Headline" },
      inputTokens: 10,
      outputTokens: 20
    });

    const output = await repository.findLatestForItem("item-local", "telegram");

    expect(output?.itemId).toBe("item-local");
    expect(output?.target).toBe("telegram");
    expect(output?.promptVersion).toBe("1.0.0");
    expect(output?.status).toBe("generated");
    expect(output?.output).toEqual({ headline: "Headline" });
    expect(output?.tokenUsage).toEqual({ inputTokens: 10, outputTokens: 20 });
  });
});
