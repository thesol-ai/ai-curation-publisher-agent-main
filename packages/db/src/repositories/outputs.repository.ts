import type { GeneratedOutput, OutputStatus, OutputTarget, TelegramAiOutput, WordPressAiOutput } from "@curator/core";
import type { D1DatabaseLike } from "../client";

export type SaveGeneratedOutputInput<TOutput = unknown> = {
  itemId: string;
  target: OutputTarget;
  promptId: string;
  promptVersion: string;
  status?: OutputStatus;
  model: string;
  output: TOutput;
  inputTokens?: number;
  outputTokens?: number;
  estimatedCostUsd?: number;
};

type OutputRow = {
  id: string;
  item_id: string;
  target: OutputTarget;
  prompt_id: string | null;
  prompt_version: string;
  status: OutputStatus;
  output_json: string;
  input_tokens: number | null;
  output_tokens: number | null;
  estimated_cost_usd: number | null;
  created_at: string;
  updated_at: string;
};

export class OutputsRepository {
  constructor(private readonly db: D1DatabaseLike) {}

  async findLatestForItem(itemId: string, target: OutputTarget): Promise<GeneratedOutput | null> {
    const row = await this.db
      .prepare("SELECT * FROM outputs WHERE item_id = ? AND target = ? ORDER BY created_at DESC LIMIT 1")
      .bind(itemId, target)
      .first<OutputRow>();

    return row ? toGeneratedOutput(row) : null;
  }

  async saveGeneratedOutput<TOutput = unknown>(input: SaveGeneratedOutputInput<TOutput>): Promise<GeneratedOutput<TOutput>> {
    const now = new Date().toISOString();
    const id = createOutputId(input.itemId, input.target, input.promptVersion);
    const outputEnvelope = {
      model: input.model,
      data: input.output
    };

    await this.db.prepare(
      `INSERT OR REPLACE INTO outputs (id, item_id, target, prompt_id, prompt_version, status, output_json, input_tokens, output_tokens, estimated_cost_usd, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      id,
      input.itemId,
      input.target,
      input.promptId,
      input.promptVersion,
      input.status ?? "generated",
      JSON.stringify(outputEnvelope),
      input.inputTokens ?? null,
      input.outputTokens ?? null,
      input.estimatedCostUsd ?? null,
      now,
      now
    ).run();

    return {
      id,
      itemId: input.itemId,
      target: input.target,
      promptVersion: input.promptVersion,
      status: input.status ?? "generated",
      output: input.output,
      ...((input.inputTokens === undefined && input.outputTokens === undefined && input.estimatedCostUsd === undefined) ? {} : {
        tokenUsage: {
          inputTokens: input.inputTokens ?? 0,
          outputTokens: input.outputTokens ?? 0,
          ...(input.estimatedCostUsd === undefined ? {} : { estimatedCostUsd: input.estimatedCostUsd })
        }
      }),
      createdAt: now,
      updatedAt: now
    };
  }
}

function toGeneratedOutput(row: OutputRow): GeneratedOutput {
  const parsed = JSON.parse(row.output_json) as { data?: TelegramAiOutput | WordPressAiOutput };

  return {
    id: row.id,
    itemId: row.item_id,
    target: row.target,
    promptVersion: row.prompt_version,
    status: row.status,
    output: parsed.data ?? (parsed as TelegramAiOutput | WordPressAiOutput),
    ...((row.input_tokens === null && row.output_tokens === null && row.estimated_cost_usd === null) ? {} : {
      tokenUsage: {
        inputTokens: row.input_tokens ?? 0,
        outputTokens: row.output_tokens ?? 0,
        ...(row.estimated_cost_usd === null ? {} : { estimatedCostUsd: row.estimated_cost_usd })
      }
    }),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function createOutputId(itemId: string, target: OutputTarget, promptVersion: string): string {
  return `output_${stableHash(`${itemId}:${target}:${promptVersion}`)}`;
}

function stableHash(value: string): string {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(index);
  }

  return (hash >>> 0).toString(16).padStart(8, "0");
}
