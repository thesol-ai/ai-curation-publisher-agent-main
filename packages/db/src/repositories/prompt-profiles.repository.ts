import type { D1DatabaseLike } from "../client";

export const PROMPT_PROFILE_STATUSES = ["draft", "active", "archived"] as const;
export type PromptProfileStatus = typeof PROMPT_PROFILE_STATUSES[number];

export type PromptProfileRecord = {
  id: string;
  name: string;
  category: string;
  language: string;
  contentType: string;
  outputTarget: string;
  version: string;
  status: PromptProfileStatus;
  systemPrompt: string;
  userPromptTemplate: string;
  outputSchemaRef: string;
  modelHint?: string;
  temperature?: number;
  maxTokens?: number;
  riskPolicy?: string;
  styleGuide?: string;
  negativePrompt?: string;
  createdAt: string;
  updatedAt: string;
  updatedBy?: string;
};

export type UpsertPromptProfileInput = {
  id: string;
  name: string;
  category?: string;
  language?: string;
  contentType?: string;
  outputTarget?: string;
  version?: string;
  status?: PromptProfileStatus;
  systemPrompt: string;
  userPromptTemplate: string;
  outputSchemaRef?: string;
  modelHint?: string;
  temperature?: number;
  maxTokens?: number;
  riskPolicy?: string;
  styleGuide?: string;
  negativePrompt?: string;
  updatedBy?: string;
};

export type PromptBindingRecord = {
  id: string;
  routeId?: string;
  routeOutputId?: string;
  category?: string;
  language?: string;
  contentType: string;
  promptProfileId: string;
  promptVersion?: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  updatedBy?: string;
};

export type PromptRunRecord = {
  id: string;
  itemId?: string;
  generatedOutputId?: string;
  promptProfileId: string;
  promptVersion: string;
  model?: string;
  provider?: string;
  renderedPromptHash?: string;
  inputTokens?: number;
  outputTokens?: number;
  status: string;
  errorMessage?: string;
  createdAt: string;
};

export type UpsertPromptRunInput = {
  id?: string;
  itemId?: string;
  generatedOutputId?: string;
  promptProfileId: string;
  promptVersion: string;
  model?: string;
  provider?: string;
  renderedPromptHash?: string;
  inputTokens?: number;
  outputTokens?: number;
  status?: string;
  errorMessage?: string;
};

export type UpsertPromptBindingInput = {
  id?: string;
  routeId?: string;
  routeOutputId?: string;
  category?: string;
  language?: string;
  contentType?: string;
  promptProfileId: string;
  promptVersion?: string;
  enabled?: boolean;
  updatedBy?: string;
};

export type PromptResolutionInput = {
  routeId: string;
  routeOutputId: string;
  category: string;
  language: string;
  contentType?: string;
  promptProfileKey?: string;
};

type PromptProfileRow = {
  id: string;
  name: string;
  category: string;
  language: string;
  content_type: string;
  output_target: string;
  version: string;
  status: PromptProfileStatus;
  system_prompt: string;
  user_prompt_template: string;
  output_schema_ref: string;
  model_hint: string | null;
  temperature: number | null;
  max_tokens: number | null;
  risk_policy: string | null;
  style_guide: string | null;
  negative_prompt: string | null;
  created_at: string;
  updated_at: string;
  updated_by: string | null;
};

type PromptBindingRow = {
  id: string;
  route_id: string | null;
  route_output_id: string | null;
  category: string | null;
  language: string | null;
  content_type: string;
  prompt_profile_id: string;
  prompt_version: string | null;
  enabled: number;
  created_at: string;
  updated_at: string;
  updated_by: string | null;
};

type PromptRunRow = {
  id: string;
  item_id: string | null;
  generated_output_id: string | null;
  prompt_profile_id: string;
  prompt_version: string;
  model: string | null;
  provider: string | null;
  rendered_prompt_hash: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  status: string;
  error_message: string | null;
  created_at: string;
};

export class PromptProfilesRepository {
  constructor(private readonly db: D1DatabaseLike) {}

  async listProfiles(status?: PromptProfileStatus): Promise<PromptProfileRecord[]> {
    const result = status === undefined
      ? await this.db.prepare("SELECT * FROM prompt_profiles ORDER BY status ASC, category ASC, language ASC, name ASC").all<PromptProfileRow>()
      : await this.db.prepare("SELECT * FROM prompt_profiles WHERE status = ? ORDER BY category ASC, language ASC, name ASC").bind(status).all<PromptProfileRow>();
    return (result.results ?? []).map(toPromptProfileRecord);
  }

  async findProfileById(id: string): Promise<PromptProfileRecord | null> {
    const row = await this.db.prepare("SELECT * FROM prompt_profiles WHERE id = ? LIMIT 1").bind(id).first<PromptProfileRow>();
    return row ? toPromptProfileRecord(row) : null;
  }

  async upsertProfile(input: UpsertPromptProfileInput): Promise<PromptProfileRecord> {
    const now = new Date().toISOString();
    const normalized = normalizePromptProfileInput(input);
    await this.db.prepare(
      `INSERT INTO prompt_profiles (id, name, category, language, content_type, output_target, version, status, system_prompt, user_prompt_template, output_schema_ref, model_hint, temperature, max_tokens, risk_policy, style_guide, negative_prompt, created_at, updated_at, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, category = excluded.category, language = excluded.language, content_type = excluded.content_type, output_target = excluded.output_target, version = excluded.version, status = excluded.status, system_prompt = excluded.system_prompt, user_prompt_template = excluded.user_prompt_template, output_schema_ref = excluded.output_schema_ref, model_hint = excluded.model_hint, temperature = excluded.temperature, max_tokens = excluded.max_tokens, risk_policy = excluded.risk_policy, style_guide = excluded.style_guide, negative_prompt = excluded.negative_prompt, updated_at = excluded.updated_at, updated_by = excluded.updated_by`
    ).bind(
      normalized.id,
      normalized.name,
      normalized.category,
      normalized.language,
      normalized.contentType,
      normalized.outputTarget,
      normalized.version,
      normalized.status,
      normalized.systemPrompt,
      normalized.userPromptTemplate,
      normalized.outputSchemaRef,
      normalized.modelHint ?? null,
      normalized.temperature ?? null,
      normalized.maxTokens ?? null,
      normalized.riskPolicy ?? null,
      normalized.styleGuide ?? null,
      normalized.negativePrompt ?? null,
      now,
      now,
      normalized.updatedBy ?? null
    ).run();
    return { ...normalized, createdAt: now, updatedAt: now };
  }

  async setProfileStatus(id: string, status: PromptProfileStatus, updatedBy?: string): Promise<PromptProfileRecord | null> {
    await this.db.prepare("UPDATE prompt_profiles SET status = ?, updated_at = ?, updated_by = ? WHERE id = ?")
      .bind(status, new Date().toISOString(), updatedBy ?? null, id)
      .run();
    return this.findProfileById(id);
  }

  async listBindings(): Promise<PromptBindingRecord[]> {
    const result = await this.db.prepare("SELECT * FROM prompt_bindings ORDER BY enabled DESC, route_output_id ASC, route_id ASC, category ASC, language ASC").all<PromptBindingRow>();
    return (result.results ?? []).map(toPromptBindingRecord);
  }

  async listRuns(limit = 25, promptProfileId?: string): Promise<PromptRunRecord[]> {
    const cappedLimit = Math.max(1, Math.min(Math.floor(limit), 100));
    const result = promptProfileId === undefined
      ? await this.db.prepare("SELECT * FROM prompt_runs ORDER BY created_at DESC LIMIT ?").bind(cappedLimit).all<PromptRunRow>()
      : await this.db.prepare("SELECT * FROM prompt_runs WHERE prompt_profile_id = ? ORDER BY created_at DESC LIMIT ?").bind(promptProfileId, cappedLimit).all<PromptRunRow>();
    return (result.results ?? []).map(toPromptRunRecord);
  }

  async createRun(input: UpsertPromptRunInput): Promise<PromptRunRecord> {
    const createdAt = new Date().toISOString();
    const id = normalizeId(input.id ?? `prun_${stableHash(`${input.promptProfileId}:${input.promptVersion}:${createdAt}:${input.status ?? "created"}`)}`);
    await this.db.prepare(
      `INSERT INTO prompt_runs (id, item_id, generated_output_id, prompt_profile_id, prompt_version, model, provider, rendered_prompt_hash, input_tokens, output_tokens, status, error_message, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      id,
      input.itemId ?? null,
      input.generatedOutputId ?? null,
      input.promptProfileId,
      input.promptVersion,
      input.model ?? null,
      input.provider ?? null,
      input.renderedPromptHash ?? null,
      input.inputTokens ?? null,
      input.outputTokens ?? null,
      input.status ?? "created",
      input.errorMessage ?? null,
      createdAt
    ).run();
    return {
      id,
      ...(input.itemId === undefined ? {} : { itemId: input.itemId }),
      ...(input.generatedOutputId === undefined ? {} : { generatedOutputId: input.generatedOutputId }),
      promptProfileId: input.promptProfileId,
      promptVersion: input.promptVersion,
      ...(input.model === undefined ? {} : { model: input.model }),
      ...(input.provider === undefined ? {} : { provider: input.provider }),
      ...(input.renderedPromptHash === undefined ? {} : { renderedPromptHash: input.renderedPromptHash }),
      ...(input.inputTokens === undefined ? {} : { inputTokens: input.inputTokens }),
      ...(input.outputTokens === undefined ? {} : { outputTokens: input.outputTokens }),
      status: input.status ?? "created",
      ...(input.errorMessage === undefined ? {} : { errorMessage: input.errorMessage }),
      createdAt
    };
  }

  async upsertBinding(input: UpsertPromptBindingInput): Promise<PromptBindingRecord> {
    const now = new Date().toISOString();
    const normalized = normalizePromptBindingInput(input);
    await this.db.prepare(
      `INSERT INTO prompt_bindings (id, route_id, route_output_id, category, language, content_type, prompt_profile_id, prompt_version, enabled, created_at, updated_at, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET route_id = excluded.route_id, route_output_id = excluded.route_output_id, category = excluded.category, language = excluded.language, content_type = excluded.content_type, prompt_profile_id = excluded.prompt_profile_id, prompt_version = excluded.prompt_version, enabled = excluded.enabled, updated_at = excluded.updated_at, updated_by = excluded.updated_by`
    ).bind(
      normalized.id,
      normalized.routeId ?? null,
      normalized.routeOutputId ?? null,
      normalized.category ?? null,
      normalized.language ?? null,
      normalized.contentType,
      normalized.promptProfileId,
      normalized.promptVersion ?? null,
      normalized.enabled ? 1 : 0,
      now,
      now,
      normalized.updatedBy ?? null
    ).run();
    return { ...normalized, createdAt: now, updatedAt: now };
  }

  async enforceSinglePromptForOutput(input: {
    routeId: string;
    routeOutputId: string;
    category: string;
    language: string;
    contentType?: string;
    promptProfileId: string;
    updatedBy?: string;
  }): Promise<void> {
    const now = new Date().toISOString();
    const contentType = input.contentType ?? "social_post";

    await this.db.prepare(
      `UPDATE prompt_bindings
       SET enabled = 0, updated_at = ?, updated_by = ?
       WHERE enabled = 1
         AND content_type = ?
         AND prompt_profile_id != ?
         AND (
           route_output_id = ?
           OR (route_id = ? AND language = ?)
           OR (category = ? AND language = ?)
         )`
    ).bind(
      now,
      input.updatedBy ?? null,
      contentType,
      input.promptProfileId,
      input.routeOutputId,
      input.routeId,
      input.language,
      input.category,
      input.language
    ).run();

    await this.db.prepare(
      `UPDATE prompt_profiles
       SET status = 'archived', updated_at = ?, updated_by = ?
       WHERE status != 'archived'
         AND output_target = 'telegram'
         AND content_type = ?
         AND category = ?
         AND language = ?
         AND id != ?`
    ).bind(
      now,
      input.updatedBy ?? null,
      contentType,
      input.category,
      input.language,
      input.promptProfileId
    ).run();
  }

  async resolvePrompt(input: PromptResolutionInput): Promise<PromptProfileRecord | null> {
    const contentType = input.contentType ?? "social_post";
    const rows = await this.db.prepare(
      `SELECT p.* FROM prompt_bindings b
       JOIN prompt_profiles p ON p.id = b.prompt_profile_id
       WHERE b.enabled = 1 AND p.status = 'active'
         AND b.content_type = ?
         AND (
           b.route_output_id = ?
           OR (b.route_output_id IS NULL AND b.route_id = ? AND (b.language IS NULL OR b.language = ?))
           OR (b.route_output_id IS NULL AND b.route_id IS NULL AND b.category = ? AND b.language = ?)
           OR (b.route_output_id IS NULL AND b.route_id IS NULL AND b.category = ? AND b.language IS NULL)
         )
       ORDER BY
         CASE
           WHEN b.route_output_id = ? THEN 1
           WHEN b.route_id = ? AND b.language = ? THEN 2
           WHEN b.route_id = ? THEN 3
           WHEN b.category = ? AND b.language = ? THEN 4
           WHEN b.category = ? THEN 5
           ELSE 9
         END ASC,
         b.updated_at DESC
       LIMIT 1`
    ).bind(
      contentType,
      input.routeOutputId,
      input.routeId,
      input.language,
      input.category,
      input.language,
      input.category,
      input.routeOutputId,
      input.routeId,
      input.language,
      input.routeId,
      input.category,
      input.language,
      input.category
    ).first<PromptProfileRow>();
    if (rows) return toPromptProfileRecord(rows);

    if (input.promptProfileKey) {
      const direct = await this.findProfileById(input.promptProfileKey);
      if (direct?.status === "active") return direct;
    }

    const fallback = await this.db.prepare(
      `SELECT * FROM prompt_profiles
       WHERE status = 'active'
         AND output_target = 'telegram'
         AND content_type = ?
         AND (category = ? OR category = '*')
         AND (language = ? OR language = '*')
       ORDER BY
         CASE WHEN category = ? THEN 0 ELSE 1 END,
         CASE WHEN language = ? THEN 0 ELSE 1 END,
         updated_at DESC
       LIMIT 1`
    ).bind(contentType, input.category, input.language, input.category, input.language).first<PromptProfileRow>();
    return fallback ? toPromptProfileRecord(fallback) : null;
  }
}

function normalizePromptProfileInput(input: UpsertPromptProfileInput): Omit<PromptProfileRecord, "createdAt" | "updatedAt"> {
  return {
    id: normalizeId(input.id),
    name: nonEmpty(input.name, "Prompt profile"),
    category: normalizeDimension(input.category),
    language: normalizeDimension(input.language),
    contentType: nonEmpty(input.contentType ?? "social_post", "social_post"),
    outputTarget: nonEmpty(input.outputTarget ?? "telegram", "telegram"),
    version: nonEmpty(input.version ?? "1.0.0", "1.0.0"),
    status: isPromptProfileStatus(input.status) ? input.status : "draft",
    systemPrompt: nonEmpty(input.systemPrompt, "You are an editorial automation assistant."),
    userPromptTemplate: nonEmpty(input.userPromptTemplate, "{{sourceText}}"),
    outputSchemaRef: nonEmpty(input.outputSchemaRef ?? "telegram_output_v1", "telegram_output_v1"),
    ...(normalizeOptional(input.modelHint) === undefined ? {} : { modelHint: normalizeOptional(input.modelHint)! }),
    ...(typeof input.temperature === "number" && Number.isFinite(input.temperature) ? { temperature: input.temperature } : {}),
    ...(typeof input.maxTokens === "number" && Number.isFinite(input.maxTokens) ? { maxTokens: Math.floor(input.maxTokens) } : {}),
    ...(normalizeOptional(input.riskPolicy) === undefined ? {} : { riskPolicy: normalizeOptional(input.riskPolicy)! }),
    ...(normalizeOptional(input.styleGuide) === undefined ? {} : { styleGuide: normalizeOptional(input.styleGuide)! }),
    ...(normalizeOptional(input.negativePrompt) === undefined ? {} : { negativePrompt: normalizeOptional(input.negativePrompt)! }),
    ...(normalizeOptional(input.updatedBy) === undefined ? {} : { updatedBy: normalizeOptional(input.updatedBy)! })
  };
}

function normalizePromptBindingInput(input: UpsertPromptBindingInput): Omit<PromptBindingRecord, "createdAt" | "updatedAt"> {
  const routeOutputId = normalizeOptional(input.routeOutputId);
  const routeId = normalizeOptional(input.routeId);
  const category = normalizeOptional(input.category);
  const language = normalizeOptional(input.language);
  const bindingIdInput = {
    ...(routeId === undefined ? {} : { routeId }),
    ...(routeOutputId === undefined ? {} : { routeOutputId }),
    ...(category === undefined ? {} : { category }),
    ...(language === undefined ? {} : { language }),
    contentType: input.contentType ?? "social_post",
    promptProfileId: input.promptProfileId
  };
  const id = input.id ?? createPromptBindingId(bindingIdInput);
  return {
    id: normalizeId(id),
    ...(routeId === undefined ? {} : { routeId }),
    ...(routeOutputId === undefined ? {} : { routeOutputId }),
    ...(category === undefined ? {} : { category }),
    ...(language === undefined ? {} : { language }),
    contentType: nonEmpty(input.contentType ?? "social_post", "social_post"),
    promptProfileId: normalizeId(input.promptProfileId),
    ...(normalizeOptional(input.promptVersion) === undefined ? {} : { promptVersion: normalizeOptional(input.promptVersion)! }),
    enabled: input.enabled !== false,
    ...(normalizeOptional(input.updatedBy) === undefined ? {} : { updatedBy: normalizeOptional(input.updatedBy)! })
  };
}

function createPromptBindingId(input: { routeId?: string; routeOutputId?: string; category?: string; language?: string; contentType: string; promptProfileId: string }): string {
  return `pbind_${stableHash([input.routeOutputId ?? "any_output", input.routeId ?? "any_route", input.category ?? "any_category", input.language ?? "any_language", input.contentType, input.promptProfileId].join(":"))}`;
}

function toPromptProfileRecord(row: PromptProfileRow): PromptProfileRecord {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    language: row.language,
    contentType: row.content_type,
    outputTarget: row.output_target,
    version: row.version,
    status: row.status,
    systemPrompt: row.system_prompt,
    userPromptTemplate: row.user_prompt_template,
    outputSchemaRef: row.output_schema_ref,
    ...(row.model_hint === null ? {} : { modelHint: row.model_hint }),
    ...(row.temperature === null ? {} : { temperature: row.temperature }),
    ...(row.max_tokens === null ? {} : { maxTokens: row.max_tokens }),
    ...(row.risk_policy === null ? {} : { riskPolicy: row.risk_policy }),
    ...(row.style_guide === null ? {} : { styleGuide: row.style_guide }),
    ...(row.negative_prompt === null ? {} : { negativePrompt: row.negative_prompt }),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.updated_by === null ? {} : { updatedBy: row.updated_by })
  };
}

function toPromptRunRecord(row: PromptRunRow): PromptRunRecord {
  return {
    id: row.id,
    ...(row.item_id === null ? {} : { itemId: row.item_id }),
    ...(row.generated_output_id === null ? {} : { generatedOutputId: row.generated_output_id }),
    promptProfileId: row.prompt_profile_id,
    promptVersion: row.prompt_version,
    ...(row.model === null ? {} : { model: row.model }),
    ...(row.provider === null ? {} : { provider: row.provider }),
    ...(row.rendered_prompt_hash === null ? {} : { renderedPromptHash: row.rendered_prompt_hash }),
    ...(row.input_tokens === null ? {} : { inputTokens: row.input_tokens }),
    ...(row.output_tokens === null ? {} : { outputTokens: row.output_tokens }),
    status: row.status,
    ...(row.error_message === null ? {} : { errorMessage: row.error_message }),
    createdAt: row.created_at
  };
}

function toPromptBindingRecord(row: PromptBindingRow): PromptBindingRecord {
  return {
    id: row.id,
    ...(row.route_id === null ? {} : { routeId: row.route_id }),
    ...(row.route_output_id === null ? {} : { routeOutputId: row.route_output_id }),
    ...(row.category === null ? {} : { category: row.category }),
    ...(row.language === null ? {} : { language: row.language }),
    contentType: row.content_type,
    promptProfileId: row.prompt_profile_id,
    ...(row.prompt_version === null ? {} : { promptVersion: row.prompt_version }),
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.updated_by === null ? {} : { updatedBy: row.updated_by })
  };
}

function isPromptProfileStatus(value: string | undefined): value is PromptProfileStatus {
  return value === "draft" || value === "active" || value === "archived";
}

function normalizeId(value: string): string {
  return value.trim().replace(/[^A-Za-z0-9_.:-]+/g, "_").slice(0, 120) || `prompt_${Date.now()}`;
}

function normalizeDimension(value: string | undefined): string {
  return normalizeOptional(value) ?? "*";
}

function normalizeOptional(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function nonEmpty(value: string, fallback: string): string {
  const normalized = normalizeOptional(value);
  return normalized ?? fallback;
}

function stableHash(value: string): string {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(index);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
