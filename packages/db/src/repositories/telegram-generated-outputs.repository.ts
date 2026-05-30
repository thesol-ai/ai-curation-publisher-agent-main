import type { D1DatabaseLike } from "../client";

export const TELEGRAM_GENERATED_OUTPUT_STATUSES = [
  "generated",
  "ready_for_review",
  "approved",
  "queued_for_publish",
  "scheduled",
  "publishing",
  "published",
  "failed",
  "cancelled"
] as const;

export type TelegramGeneratedOutputStatus = typeof TELEGRAM_GENERATED_OUTPUT_STATUSES[number];

export type TelegramLocalizedOutput = {
  language: string;
  caption: string;
  summary?: string;
  headline?: string;
  hashtags: string[];
  riskFlags: string[];
  relevanceScore?: number;
  sourceAttributionText: string;
  originalCaption?: string;
  editedBy?: string;
  editedAt?: string;
  editCount?: number;
};

export type TelegramGeneratedOutputRecord<TOutput = TelegramLocalizedOutput> = {
  id: string;
  itemId: string;
  routeId: string;
  routeOutputId: string;
  language: string;
  status: TelegramGeneratedOutputStatus;
  promptProfile: string;
  model?: string;
  output: TOutput;
  inputTokens?: number;
  outputTokens?: number;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
};

export type SaveTelegramGeneratedOutputInput<TOutput = TelegramLocalizedOutput> = {
  itemId: string;
  routeId: string;
  routeOutputId: string;
  language: string;
  status?: TelegramGeneratedOutputStatus;
  promptProfile: string;
  model?: string;
  output: TOutput;
  inputTokens?: number;
  outputTokens?: number;
  errorMessage?: string;
};

type TelegramGeneratedOutputRow = {
  id: string;
  item_id: string;
  route_id: string;
  route_output_id: string;
  language: string;
  status: TelegramGeneratedOutputStatus;
  prompt_profile: string;
  model: string | null;
  output_json: string;
  input_tokens: number | null;
  output_tokens: number | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
};

export class TelegramGeneratedOutputsRepository {
  constructor(private readonly db: D1DatabaseLike) {}

  async save<TOutput = TelegramLocalizedOutput>(input: SaveTelegramGeneratedOutputInput<TOutput>): Promise<TelegramGeneratedOutputRecord<TOutput>> {
    const now = new Date().toISOString();
    const id = createTelegramGeneratedOutputId(input.itemId, input.routeOutputId);
    const status = input.status ?? "generated";

    await this.db.prepare(
      `INSERT INTO telegram_generated_outputs (id, item_id, route_id, route_output_id, language, status, prompt_profile, model, output_json, input_tokens, output_tokens, error_message, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(item_id, route_output_id) DO UPDATE SET status = excluded.status, prompt_profile = excluded.prompt_profile, model = excluded.model, output_json = excluded.output_json, input_tokens = excluded.input_tokens, output_tokens = excluded.output_tokens, error_message = excluded.error_message, updated_at = excluded.updated_at`
    ).bind(
      id,
      input.itemId,
      input.routeId,
      input.routeOutputId,
      input.language,
      status,
      input.promptProfile,
      input.model ?? null,
      JSON.stringify(input.output),
      input.inputTokens ?? null,
      input.outputTokens ?? null,
      input.errorMessage ?? null,
      now,
      now
    ).run();

    return {
      id,
      itemId: input.itemId,
      routeId: input.routeId,
      routeOutputId: input.routeOutputId,
      language: input.language,
      status,
      promptProfile: input.promptProfile,
      ...(input.model === undefined ? {} : { model: input.model }),
      output: input.output,
      ...(input.inputTokens === undefined ? {} : { inputTokens: input.inputTokens }),
      ...(input.outputTokens === undefined ? {} : { outputTokens: input.outputTokens }),
      ...(input.errorMessage === undefined ? {} : { errorMessage: input.errorMessage }),
      createdAt: now,
      updatedAt: now
    };
  }

  async findById(id: string): Promise<TelegramGeneratedOutputRecord | null> {
    const row = await this.db.prepare("SELECT * FROM telegram_generated_outputs WHERE id = ?").bind(id).first<TelegramGeneratedOutputRow>();
    return row ? toGeneratedOutputRecord(row) : null;
  }
  async listByItemId(itemId: string): Promise<TelegramGeneratedOutputRecord[]> {
    const result = await this.db
      .prepare("SELECT * FROM telegram_generated_outputs WHERE item_id = ? ORDER BY created_at ASC")
      .bind(itemId)
      .all<TelegramGeneratedOutputRow>();

    return (result.results ?? []).map(toGeneratedOutputRecord);
  }


  async updateStatus(id: string, status: TelegramGeneratedOutputStatus, errorMessage?: string): Promise<void> {
    await this.db.prepare("UPDATE telegram_generated_outputs SET status = ?, error_message = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .bind(status, errorMessage ?? null, id)
      .run();
  }

  async updateCaption(id: string, caption: string, metadata: { editedBy: string; editedAt?: string }): Promise<TelegramGeneratedOutputRecord | null> {
    const current = await this.findById(id);
    if (!current) return null;

    const now = metadata.editedAt ?? new Date().toISOString();
    const currentOutput = current.output as TelegramLocalizedOutput;
    const updatedOutput: TelegramLocalizedOutput = {
      ...currentOutput,
      originalCaption: currentOutput.originalCaption ?? currentOutput.caption,
      caption,
      editedBy: metadata.editedBy,
      editedAt: now,
      editCount: (currentOutput.editCount ?? 0) + 1
    };

    await this.db.prepare("UPDATE telegram_generated_outputs SET output_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .bind(JSON.stringify(updatedOutput), id)
      .run();

    return { ...current, output: updatedOutput, updatedAt: now };
  }
}

export function createTelegramGeneratedOutputId(itemId: string, routeOutputId: string): string {
  return `tgout_${stableHash(`${itemId}:${routeOutputId}`)}`;
}

function toGeneratedOutputRecord(row: TelegramGeneratedOutputRow): TelegramGeneratedOutputRecord {
  return {
    id: row.id,
    itemId: row.item_id,
    routeId: row.route_id,
    routeOutputId: row.route_output_id,
    language: row.language,
    status: row.status,
    promptProfile: row.prompt_profile,
    ...(row.model === null ? {} : { model: row.model }),
    output: parseOutput(row.output_json),
    ...(row.input_tokens === null ? {} : { inputTokens: row.input_tokens }),
    ...(row.output_tokens === null ? {} : { outputTokens: row.output_tokens }),
    ...(row.error_message === null ? {} : { errorMessage: row.error_message }),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function parseOutput(value: string): TelegramLocalizedOutput {
  try {
    const parsed = JSON.parse(value) as TelegramLocalizedOutput;
    return parsed;
  } catch {
    return { language: "unknown", caption: "", hashtags: [], riskFlags: [], sourceAttributionText: "" };
  }
}

function stableHash(value: string): string {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(index);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
