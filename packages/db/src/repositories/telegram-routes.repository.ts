import type { D1DatabaseLike } from "../client";

export type TelegramPublishMode = "immediate" | "scheduled" | "queued";

export type TelegramRouteRecord = {
  id: string;
  category: string;
  sourceChatId: string;
  sourceThreadId: number;
  promptProfile: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type TelegramRouteOutputRecord = {
  id: string;
  routeId: string;
  language: string;
  reviewChatId: string;
  reviewThreadId: number;
  finalChatId: string;
  finalThreadId?: number;
  enabled: boolean;
  publishEnabled: boolean;
  publishMode: TelegramPublishMode;
  timezone: string;
  allowedPublishWindows: string[];
  minimumGapMinutes: number;
  maxPostsPerHour: number;
  maxPostsPerDay: number;
  queuePriority: number;
  signatureEnabled: boolean;
  signatureText?: string;
  signatureChannelHandle?: string;
  signaturePosition: "append";
  createdAt: string;
  updatedAt: string;
};

export type TelegramRouteWithOutputs = {
  route: TelegramRouteRecord;
  outputs: TelegramRouteOutputRecord[];
};

export type UpsertTelegramRouteInput = {
  id: string;
  category: string;
  sourceChatId: string;
  sourceThreadId: number;
  promptProfile: string;
  enabled?: boolean;
};

export type UpsertTelegramRouteOutputInput = {
  id: string;
  routeId: string;
  language: string;
  reviewChatId: string;
  reviewThreadId: number;
  finalChatId: string;
  finalThreadId?: number;
  enabled?: boolean;
  publishEnabled?: boolean;
  publishMode?: TelegramPublishMode;
  timezone?: string;
  allowedPublishWindows?: string[];
  minimumGapMinutes?: number;
  maxPostsPerHour?: number;
  maxPostsPerDay?: number;
  queuePriority?: number;
  signatureEnabled?: boolean;
  signatureText?: string;
  signatureChannelHandle?: string;
  signaturePosition?: "append";
};

type TelegramRouteRow = {
  id: string;
  category: string;
  source_chat_id: string;
  source_thread_id: number;
  prompt_profile: string;
  enabled: number;
  created_at: string;
  updated_at: string;
};

type TelegramRouteOutputRow = {
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

export class TelegramRoutesRepository {
  constructor(private readonly db: D1DatabaseLike) {}

  async findEnabledRouteForSource(sourceChatId: string, sourceThreadId: number): Promise<TelegramRouteWithOutputs | null> {
    const routeRow = await this.db
      .prepare("SELECT * FROM telegram_routes WHERE source_chat_id = ? AND source_thread_id = ? AND enabled = 1 LIMIT 1")
      .bind(sourceChatId, sourceThreadId)
      .first<TelegramRouteRow>();

    if (!routeRow) {
      return null;
    }

    const outputRows = await this.db
      .prepare("SELECT * FROM telegram_route_outputs WHERE route_id = ? AND enabled = 1 ORDER BY language ASC, id ASC")
      .bind(routeRow.id)
      .all<TelegramRouteOutputRow>();

    return {
      route: toRouteRecord(routeRow),
      outputs: (outputRows.results ?? []).map(toRouteOutputRecord)
    };
  }

  async findRouteById(id: string): Promise<TelegramRouteRecord | null> {
    const row = await this.db.prepare("SELECT * FROM telegram_routes WHERE id = ? LIMIT 1").bind(id).first<TelegramRouteRow>();
    return row ? toRouteRecord(row) : null;
  }

  async findRouteBySource(sourceChatId: string, sourceThreadId: number): Promise<TelegramRouteRecord | null> {
    const row = await this.db.prepare("SELECT * FROM telegram_routes WHERE source_chat_id = ? AND source_thread_id = ? LIMIT 1").bind(sourceChatId, sourceThreadId).first<TelegramRouteRow>();
    return row ? toRouteRecord(row) : null;
  }

  async findOutputById(id: string): Promise<TelegramRouteOutputRecord | null> {
    const row = await this.db.prepare("SELECT * FROM telegram_route_outputs WHERE id = ? LIMIT 1").bind(id).first<TelegramRouteOutputRow>();
    return row ? toRouteOutputRecord(row) : null;
  }

  async listRoutes(): Promise<TelegramRouteRecord[]> {
    const result = await this.db.prepare("SELECT * FROM telegram_routes ORDER BY category ASC, id ASC").all<TelegramRouteRow>();
    return (result.results ?? []).map(toRouteRecord);
  }

  async listOutputs(): Promise<TelegramRouteOutputRecord[]> {
    const result = await this.db.prepare("SELECT * FROM telegram_route_outputs ORDER BY route_id ASC, language ASC, id ASC").all<TelegramRouteOutputRow>();
    return (result.results ?? []).map(toRouteOutputRecord);
  }

  async listOutputsForRoute(routeId: string): Promise<TelegramRouteOutputRecord[]> {
    const result = await this.db.prepare("SELECT * FROM telegram_route_outputs WHERE route_id = ? ORDER BY language ASC, id ASC").bind(routeId).all<TelegramRouteOutputRow>();
    return (result.results ?? []).map(toRouteOutputRecord);
  }

  async countSummary(): Promise<{ routeCount: number; enabledRouteCount: number; outputCount: number; enabledOutputCount: number; reviewRoutingConfigured: boolean }> {
    const routeCount = await this.count("telegram_routes", "1 = 1");
    const enabledRouteCount = await this.count("telegram_routes", "enabled = 1");
    const outputCount = await this.count("telegram_route_outputs", "1 = 1");
    const enabledOutputCount = await this.count("telegram_route_outputs", "enabled = 1");
    const reviewRoutingConfigured = enabledRouteCount > 0 && enabledOutputCount > 0;
    return { routeCount, enabledRouteCount, outputCount, enabledOutputCount, reviewRoutingConfigured };
  }

  async upsertRoute(input: UpsertTelegramRouteInput): Promise<TelegramRouteRecord> {
    const now = new Date().toISOString();
    await this.db.prepare(
      `INSERT INTO telegram_routes (id, category, source_chat_id, source_thread_id, prompt_profile, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET category = excluded.category, source_chat_id = excluded.source_chat_id, source_thread_id = excluded.source_thread_id, prompt_profile = excluded.prompt_profile, enabled = excluded.enabled, updated_at = excluded.updated_at`
    ).bind(input.id, input.category, input.sourceChatId, input.sourceThreadId, input.promptProfile, input.enabled === false ? 0 : 1, now, now).run();

    return {
      id: input.id,
      category: input.category,
      sourceChatId: input.sourceChatId,
      sourceThreadId: input.sourceThreadId,
      promptProfile: input.promptProfile,
      enabled: input.enabled !== false,
      createdAt: now,
      updatedAt: now
    };
  }

  async upsertRouteOutput(input: UpsertTelegramRouteOutputInput): Promise<TelegramRouteOutputRecord> {
    const now = new Date().toISOString();
    const settings = normalizeRouteOutputSettings(input);
    await this.db.prepare(
      `INSERT INTO telegram_route_outputs (id, route_id, language, review_chat_id, review_thread_id, final_chat_id, final_thread_id, enabled, publish_enabled, publish_mode, timezone, allowed_publish_windows_json, minimum_gap_minutes, max_posts_per_hour, max_posts_per_day, queue_priority, signature_enabled, signature_text, signature_channel_handle, signature_position, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET route_id = excluded.route_id, language = excluded.language, review_chat_id = excluded.review_chat_id, review_thread_id = excluded.review_thread_id, final_chat_id = excluded.final_chat_id, final_thread_id = excluded.final_thread_id, enabled = excluded.enabled, publish_enabled = excluded.publish_enabled, publish_mode = excluded.publish_mode, timezone = excluded.timezone, allowed_publish_windows_json = excluded.allowed_publish_windows_json, minimum_gap_minutes = excluded.minimum_gap_minutes, max_posts_per_hour = excluded.max_posts_per_hour, max_posts_per_day = excluded.max_posts_per_day, queue_priority = excluded.queue_priority, signature_enabled = excluded.signature_enabled, signature_text = excluded.signature_text, signature_channel_handle = excluded.signature_channel_handle, signature_position = excluded.signature_position, updated_at = excluded.updated_at`
    ).bind(input.id, input.routeId, input.language, input.reviewChatId, input.reviewThreadId, input.finalChatId, input.finalThreadId ?? null, input.enabled === false ? 0 : 1, settings.publishEnabled ? 1 : 0, settings.publishMode, settings.timezone, JSON.stringify(settings.allowedPublishWindows), settings.minimumGapMinutes, settings.maxPostsPerHour, settings.maxPostsPerDay, settings.queuePriority, settings.signatureEnabled ? 1 : 0, settings.signatureText ?? null, settings.signatureChannelHandle ?? null, settings.signaturePosition, now, now).run();

    return {
      id: input.id,
      routeId: input.routeId,
      language: input.language,
      reviewChatId: input.reviewChatId,
      reviewThreadId: input.reviewThreadId,
      finalChatId: input.finalChatId,
      ...(input.finalThreadId === undefined ? {} : { finalThreadId: input.finalThreadId }),
      enabled: input.enabled !== false,
      ...settings,
      createdAt: now,
      updatedAt: now
    };
  }

  async disableRoute(id: string): Promise<boolean> {
    const result = await this.db.prepare("UPDATE telegram_routes SET enabled = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(id).run();
    return (result.changes ?? 0) > 0;
  }

  async disableRouteOutput(id: string): Promise<boolean> {
    const result = await this.db.prepare("UPDATE telegram_route_outputs SET enabled = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(id).run();
    return (result.changes ?? 0) > 0;
  }

  private async count(tableName: "telegram_routes" | "telegram_route_outputs", whereClause: string): Promise<number> {
    try {
      const row = await this.db.prepare(`SELECT COUNT(*) AS count FROM ${tableName} WHERE ${whereClause}`).first<{ count: number }>();
      return row?.count ?? 0;
    } catch {
      return 0;
    }
  }
}

function toRouteRecord(row: TelegramRouteRow): TelegramRouteRecord {
  return {
    id: row.id,
    category: row.category,
    sourceChatId: row.source_chat_id,
    sourceThreadId: row.source_thread_id,
    promptProfile: row.prompt_profile,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toRouteOutputRecord(row: TelegramRouteOutputRow): TelegramRouteOutputRecord {
  const settingsInput: Partial<UpsertTelegramRouteOutputInput> = {};
  if (row.publish_enabled !== undefined && row.publish_enabled !== null) settingsInput.publishEnabled = row.publish_enabled === 1;
  const publishMode = normalizePublishMode(row.publish_mode);
  if (publishMode !== undefined) settingsInput.publishMode = publishMode;
  if (row.timezone !== undefined && row.timezone !== null) settingsInput.timezone = row.timezone;
  const windows = parseWindows(row.allowed_publish_windows_json);
  if (windows !== undefined) settingsInput.allowedPublishWindows = windows;
  if (row.minimum_gap_minutes !== undefined && row.minimum_gap_minutes !== null) settingsInput.minimumGapMinutes = row.minimum_gap_minutes;
  if (row.max_posts_per_hour !== undefined && row.max_posts_per_hour !== null) settingsInput.maxPostsPerHour = row.max_posts_per_hour;
  if (row.max_posts_per_day !== undefined && row.max_posts_per_day !== null) settingsInput.maxPostsPerDay = row.max_posts_per_day;
  if (row.queue_priority !== undefined && row.queue_priority !== null) settingsInput.queuePriority = row.queue_priority;
  if (row.signature_enabled !== undefined && row.signature_enabled !== null) settingsInput.signatureEnabled = row.signature_enabled === 1;
  if (row.signature_text !== undefined && row.signature_text !== null) settingsInput.signatureText = row.signature_text;
  if (row.signature_channel_handle !== undefined && row.signature_channel_handle !== null) settingsInput.signatureChannelHandle = row.signature_channel_handle;
  if (row.signature_position === "append") settingsInput.signaturePosition = "append";
  const settings = normalizeRouteOutputSettings(settingsInput);
  return {
    id: row.id,
    routeId: row.route_id,
    language: row.language,
    reviewChatId: row.review_chat_id,
    reviewThreadId: row.review_thread_id,
    finalChatId: row.final_chat_id,
    ...(row.final_thread_id === null ? {} : { finalThreadId: row.final_thread_id }),
    enabled: row.enabled === 1,
    ...settings,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function normalizeRouteOutputSettings(input: Partial<UpsertTelegramRouteOutputInput>): Required<Pick<TelegramRouteOutputRecord, "publishEnabled" | "publishMode" | "timezone" | "allowedPublishWindows" | "minimumGapMinutes" | "maxPostsPerHour" | "maxPostsPerDay" | "queuePriority" | "signatureEnabled" | "signaturePosition">> & Pick<TelegramRouteOutputRecord, "signatureText" | "signatureChannelHandle"> {
  const signatureText = normalizeOptionalString(input.signatureText);
  const signatureChannelHandle = normalizeOptionalString(input.signatureChannelHandle);
  return {
    publishEnabled: input.publishEnabled !== false,
    publishMode: input.publishMode ?? "scheduled",
    timezone: input.timezone?.trim() || "UTC",
    allowedPublishWindows: Array.isArray(input.allowedPublishWindows) ? input.allowedPublishWindows.filter((value): value is string => typeof value === "string" && value.trim().length > 0).map((value) => value.trim()) : [],
    minimumGapMinutes: normalizeNonNegativeInteger(input.minimumGapMinutes, 10),
    maxPostsPerHour: normalizeNonNegativeInteger(input.maxPostsPerHour, 4),
    maxPostsPerDay: normalizeNonNegativeInteger(input.maxPostsPerDay, 24),
    queuePriority: normalizeInteger(input.queuePriority, 0),
    signatureEnabled: input.signatureEnabled === true,
    ...(signatureText === undefined ? {} : { signatureText }),
    ...(signatureChannelHandle === undefined ? {} : { signatureChannelHandle }),
    signaturePosition: "append"
  };
}

function normalizePublishMode(value: string | null | undefined): TelegramPublishMode | undefined {
  return value === "immediate" || value === "scheduled" || value === "queued" ? value : undefined;
}

function parseWindows(value: string | null | undefined): string[] | undefined {
  if (value === undefined || value === null || value.trim().length === 0) return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed)) return parsed.filter((entry): entry is string => typeof entry === "string");
  } catch {}
  return undefined;
}

function normalizeOptionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function normalizeInteger(value: number | undefined, fallback: number): number {
  return value === undefined || !Number.isFinite(value) ? fallback : Math.floor(value);
}

function normalizeNonNegativeInteger(value: number | undefined, fallback: number): number {
  const normalized = normalizeInteger(value, fallback);
  return normalized < 0 ? fallback : normalized;
}
