import { MediaProcessingJobsRepository, PromptProfilesRepository, TelegramPublishQueueRepository, TelegramRoutesRepository, type TelegramRouteOutputRecord, type TelegramRouteRecord } from "@curator/db";
import { getEffectiveEnv, setConfigValues, type SetAdminConfigInput } from "../admin-config/service";
import { readOperationalConfig } from "../config";
import { jsonResponse } from "../http/json";
import { verifyInternalRequest } from "../security/internal-auth";
import { badRequest, methodNotAllowed, parseJsonBody, unauthorized } from "./response";
import type { Env } from "../types";

type AdminIssueSeverity = "error" | "warning" | "info";
type AdminIssue = { severity: AdminIssueSeverity; area: string; code: string; message: string; action: string; routeId?: string; outputId?: string };
type RouteWithOutputs = TelegramRouteRecord & { outputs: TelegramRouteOutputRecord[] };
type MediaSettingsPatch = { updates?: SetAdminConfigInput[] } & Record<string, unknown>;
type AdminMediaSettings = { mode: string; enabled: boolean; cacheChatId: string; cacheThreadId: string; stagingChatId: string; stagingThreadId: string; maxPhotoMb: number; maxFileMb: number; maxAssets: number; reviewWaitMode: string; reviewAllowPartial: boolean; finalRequireReady: boolean; finalAllowTextFallback: boolean; aspectDriftThreshold: number; fallbackProviderConfigured: boolean; fallbackProviders: { enabled: boolean; xOrder: string; instagramOrder: string; galleryDlEnabled: boolean; instaloaderEnabled: boolean }; videoOutput: { profile: string; transcodePolicy: string; maxSide: number; crf: number; audioBitrate: string }; github: { enabled: boolean; repository: string; workflowId: string; ref: string; callbackUrl: string } };

const MEDIA_SETTING_KEYS = new Set([
  "MEDIA_PROCESSING_MODE",
  "GITHUB_MEDIA_PROCESSOR_ENABLED",
  "GITHUB_MEDIA_PROCESSOR_REPOSITORY",
  "GITHUB_MEDIA_PROCESSOR_WORKFLOW_ID",
  "GITHUB_MEDIA_PROCESSOR_REF",
  "GITHUB_MEDIA_PROCESSOR_CALLBACK_URL",
  "TELEGRAM_MEDIA_STAGING_CHAT_ID",
  "TELEGRAM_MEDIA_STAGING_THREAD_ID",
  "TELEGRAM_MEDIA_CACHE_CHAT_ID",
  "TELEGRAM_MEDIA_CACHE_THREAD_ID",
  "TELEGRAM_MEDIA_MAX_PHOTO_MB",
  "TELEGRAM_MEDIA_MAX_FILE_MB",
  "MEDIA_MAX_ASSETS",
  "YTDLP_CONCURRENT_FRAGMENTS",
  "MEDIA_FASTSTART_COPY",
  "MEDIA_REVIEW_WAIT_MODE",
  "MEDIA_REVIEW_ALLOW_PARTIAL",
  "MEDIA_FINAL_REQUIRE_READY",
  "MEDIA_FINAL_ALLOW_TEXT_FALLBACK",
  "MEDIA_ASPECT_DRIFT_THRESHOLD",
  "MEDIA_FALLBACK_PROVIDER_ENDPOINT",
  "MEDIA_FALLBACK_ENABLED",
  "MEDIA_FALLBACK_PROVIDER_ORDER_X",
  "MEDIA_FALLBACK_PROVIDER_ORDER_INSTAGRAM",
  "MEDIA_GALLERY_DL_ENABLED",
  "MEDIA_GALLERY_DL_TIMEOUT_SECONDS",
  "MEDIA_INSTALOADER_ENABLED",
  "MEDIA_INSTALOADER_TIMEOUT_SECONDS",
  "MEDIA_VIDEO_OUTPUT_PROFILE",
  "MEDIA_VIDEO_TRANSCODE_POLICY",
  "MEDIA_MAX_VIDEO_SIDE",
  "MEDIA_VIDEO_CRF",
  "MEDIA_VIDEO_AUDIO_BITRATE"
]);

export async function handleInternalAdminOverview(request: Request, env: Env): Promise<Response> {
  const auth = verifyInternalRequest(request, env);
  if (!auth.ok) return unauthorized(auth.error, "Internal API authorization failed.", request);

  const url = new URL(request.url);
  const path = url.pathname;

  if (path === "/internal/admin/summary" && request.method === "GET") {
    return jsonResponse(await buildAdminSummary(env));
  }

  if (path === "/internal/admin/validate" && request.method === "GET") {
    return jsonResponse(await buildAdminValidation(env));
  }

  if (path === "/internal/admin/metrics/overview" && request.method === "GET") {
    return jsonResponse(await buildMetricsOverview(env));
  }

  if (path === "/internal/admin/metrics/timeseries" && request.method === "GET") {
    const range = Number(url.searchParams.get("rangeDays") ?? 30);
    return jsonResponse(await buildMetricsTimeseries(env, Number.isFinite(range) ? range : 30));
  }

  if (path === "/internal/admin/config/export" && request.method === "GET") {
    return jsonResponse(await buildConfigExport(env));
  }

  if (path === "/internal/admin/media/settings" && request.method === "GET") {
    const effectiveEnv = await getEffectiveEnv(env);
    return jsonResponse({ ok: true, media: readMediaSettings(effectiveEnv), secrets: readConfiguredSecrets(effectiveEnv) });
  }

  if (path === "/internal/admin/media/settings" && request.method === "PATCH") {
    const parsed = await parseJsonBody<MediaSettingsPatch>(request);
    if (!parsed.ok) return parsed.response;
    const updates = normalizeMediaSettingsPatch(parsed.value);
    if (!updates.ok) return badRequest(updates.error, updates.message, request);
    const result = await setConfigValues(env, updates.updates, request);
    if (!result.ok) return badRequest(result.error, result.message, request);
    const effectiveEnv = await getEffectiveEnv(env);
    return jsonResponse({ ok: true, media: readMediaSettings(effectiveEnv), config: result.response });
  }

  return methodNotAllowed(["GET", "PATCH"], request);
}

async function buildAdminSummary(env: Env): Promise<Record<string, unknown>> {
  const effectiveEnv = await getEffectiveEnv(env);
  const config = readOperationalConfig(effectiveEnv);
  const routes = await readRoutesWithOutputs(effectiveEnv);
  const validation = await validateAdminSetup(effectiveEnv, routes);
  const mediaJobs = await safeRecentMediaJobs(effectiveEnv, 25);
  const publishQueue = await safeRecentPublishQueue(effectiveEnv, 25);
  const generatedOutputCounts = await countByColumn(effectiveEnv.DB, "telegram_generated_outputs", "status");
  const mediaJobCounts = await countByColumn(effectiveEnv.DB, "media_processing_jobs", "status");
  const publishQueueCounts = await countByColumn(effectiveEnv.DB, "telegram_publish_queue", "status");
  const promptSummary = await safePromptSummary(effectiveEnv);

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    service: config.serviceName,
    environment: config.environment,
    environmentDetails: readEnvironmentDetails(effectiveEnv, config.serviceName),
    operatingMode: config.operatingMode,
    mockMode: config.mockMode,
    readiness: buildReadiness(validation.issues),
    routes: {
      count: routes.length,
      enabledCount: routes.filter((route) => route.enabled).length,
      outputsCount: routes.reduce((total, route) => total + route.outputs.length, 0),
      enabledOutputsCount: routes.reduce((total, route) => total + route.outputs.filter((output) => output.enabled).length, 0),
      items: routes
    },
    ai: config.ai,
    media: readMediaSettings(effectiveEnv),
    publishing: {
      finalPublishingEnabled: effectiveEnv.TELEGRAM_FINAL_PUBLISH_ENABLED === "true",
      publishSchedulerEnabled: effectiveEnv.TELEGRAM_PUBLISH_SCHEDULER_ENABLED === "true",
      dueLimit: readInteger(effectiveEnv.TELEGRAM_PUBLISH_DUE_LIMIT, 5),
      dryRun: effectiveEnv.SCHEDULER_DRY_RUN === "true",
      maxPublishItemsPerRun: readInteger(effectiveEnv.MAX_PUBLISH_ITEMS_PER_RUN, 0),
      workerCron: "*/30 * * * *",
      queueCounts: publishQueueCounts,
      recentQueue: publishQueue
    },
    jobs: {
      mediaCounts: mediaJobCounts,
      recentMediaJobs: mediaJobs
    },
    outputs: {
      statusCounts: generatedOutputCounts
    },
    secrets: readConfiguredSecrets(effectiveEnv),
    secretSources: readSecretSources(env, effectiveEnv),
    prompts: promptSummary,
    issues: validation.issues.slice(0, 20)
  };
}

async function buildMetricsOverview(env: Env): Promise<Record<string, unknown>> {
  const effectiveEnv = await getEffectiveEnv(env);
  const routes = await readRoutesWithOutputs(effectiveEnv);
  const generatedOutputCounts = await countByColumn(effectiveEnv.DB, "telegram_generated_outputs", "status");
  const mediaJobCounts = await countByColumn(effectiveEnv.DB, "media_processing_jobs", "status");
  const publishQueueCounts = await countByColumn(effectiveEnv.DB, "telegram_publish_queue", "status");
  const languageCounts = await countByColumn(effectiveEnv.DB, "telegram_generated_outputs", "language");
  const routeBreakdown = routes.map((route) => ({
    routeId: route.id,
    category: route.category,
    enabled: route.enabled,
    outputs: route.outputs.length,
    enabledOutputs: route.outputs.filter((output) => output.enabled).length,
    languages: Array.from(new Set(route.outputs.map((output) => output.language)))
  }));
  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    cards: {
      activeRoutes: routes.filter((route) => route.enabled).length,
      enabledOutputs: routes.reduce((total, route) => total + route.outputs.filter((output) => output.enabled).length, 0),
      readyForReview: generatedOutputCounts.ready_for_review ?? 0,
      scheduled: publishQueueCounts.scheduled ?? 0,
      published: generatedOutputCounts.published ?? 0,
      failedOutputs: generatedOutputCounts.failed ?? 0,
      mediaPending: (mediaJobCounts.pending ?? 0) + (mediaJobCounts.dispatching ?? 0) + (mediaJobCounts.dispatched ?? 0) + (mediaJobCounts.processing ?? 0),
      mediaFailed: mediaJobCounts.failed ?? 0
    },
    distributions: {
      outputsByStatus: generatedOutputCounts,
      publishQueueByStatus: publishQueueCounts,
      mediaJobsByStatus: mediaJobCounts,
      outputsByLanguage: languageCounts
    },
    timeSeries: {
      generatedLast7Days: await countByDateBucket(effectiveEnv.DB, "telegram_generated_outputs", "created_at", 7),
      generatedLast30Days: await countByDateBucket(effectiveEnv.DB, "telegram_generated_outputs", "created_at", 30),
      publishQueueLast7Days: await countByDateBucket(effectiveEnv.DB, "telegram_publish_queue", "created_at", 7),
      publishedLast30Days: await countByDateBucket(effectiveEnv.DB, "telegram_publish_queue", "updated_at", 30, "status = 'published'"),
      mediaJobsLast30Days: await countByDateBucket(effectiveEnv.DB, "media_processing_jobs", "created_at", 30)
    },
    routes: routeBreakdown,
    prompts: await safePromptSummary(effectiveEnv)
  };
}

async function buildMetricsTimeseries(env: Env, rangeDays: number): Promise<Record<string, unknown>> {
  const effectiveEnv = await getEffectiveEnv(env);
  const days = Math.max(7, Math.min(Math.floor(rangeDays), 90));
  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    rangeDays: days,
    series: {
      outputs: await countByDateBucket(effectiveEnv.DB, "telegram_generated_outputs", "created_at", days),
      published: await countByDateBucket(effectiveEnv.DB, "telegram_publish_queue", "updated_at", days, "status = 'published'"),
      mediaJobs: await countByDateBucket(effectiveEnv.DB, "media_processing_jobs", "created_at", days)
    }
  };
}

async function buildAdminValidation(env: Env): Promise<Record<string, unknown>> {
  const effectiveEnv = await getEffectiveEnv(env);
  const routes = await readRoutesWithOutputs(effectiveEnv);
  const validation = await validateAdminSetup(effectiveEnv, routes);
  return { ok: true, ...validation, readiness: buildReadiness(validation.issues) };
}

async function buildConfigExport(env: Env): Promise<Record<string, unknown>> {
  const effectiveEnv = await getEffectiveEnv(env);
  const routes = await readRoutesWithOutputs(effectiveEnv);
  const validation = await validateAdminSetup(effectiveEnv, routes);
  const promptSummary = await safePromptSummary(effectiveEnv);
  return {
    ok: true,
    version: 1,
    exportedAt: new Date().toISOString(),
    note: "Secrets are intentionally excluded. Only configured/missing flags are exported.",
    routes,
    mediaSettings: readMediaSettings(effectiveEnv),
    aiSettings: {
      provider: effectiveEnv.AI_PROVIDER ?? "mock",
      model: effectiveEnv.AI_MODEL ?? "mock",
      fallbackModels: effectiveEnv.AI_MODEL_FALLBACKS ?? "[]",
      outputLanguage: effectiveEnv.AI_OUTPUT_LANGUAGE ?? "fa",
      tonePreset: effectiveEnv.AI_TONE_PRESET ?? "neutral",
      maxOutputTokens: effectiveEnv.AI_MAX_OUTPUT_TOKENS ?? "1200",
      temperature: effectiveEnv.AI_TEMPERATURE ?? "0.4"
    },
    publishing: {
      telegramFinalPublishingEnabled: effectiveEnv.TELEGRAM_FINAL_PUBLISH_ENABLED === "true",
      telegramPublishSchedulerEnabled: effectiveEnv.TELEGRAM_PUBLISH_SCHEDULER_ENABLED === "true",
      dueLimit: effectiveEnv.TELEGRAM_PUBLISH_DUE_LIMIT ?? "5"
    },
    secrets: readConfiguredSecrets(effectiveEnv),
    secretSources: readSecretSources(env, effectiveEnv),
    prompts: promptSummary,
    validation
  };
}

async function readRoutesWithOutputs(env: Env): Promise<RouteWithOutputs[]> {
  try {
    const repository = new TelegramRoutesRepository(env.DB);
    const routes = await repository.listRoutes();
    const outputs = await repository.listOutputs();
    return routes.map((route) => ({ ...route, outputs: outputs.filter((output) => output.routeId === route.id) }));
  } catch {
    return [];
  }
}

async function validateAdminSetup(env: Env, routes: RouteWithOutputs[]): Promise<{ valid: boolean; issues: AdminIssue[] }> {
  const issues: AdminIssue[] = [];
  const media = readMediaSettings(env);
  const secrets = readConfiguredSecrets(env);

  if (!secrets.internalApiSecret) issues.push(issue("error", "security", "internal_secret_missing", "Internal admin secret is not configured.", "Set INTERNAL_API_SECRET as a Worker Secret before using the dashboard in shared environments."));
  if (!secrets.configEncryptionKey) issues.push(issue("warning", "security", "config_encryption_missing", "Config encryption key is not configured.", "Set CONFIG_ENCRYPTION_KEY before editing encrypted dashboard secrets."));
  if (routes.length === 0) issues.push(issue("warning", "routes", "routes_missing", "No Telegram routes are configured.", "Create a route in Setup Wizard or import a route config."));
  if (routes.some((route) => route.enabled) && !secrets.telegramBotToken) issues.push(issue("error", "telegram", "telegram_bot_token_missing", "Telegram routes are enabled but TELEGRAM_BOT_TOKEN is missing.", "Add TELEGRAM_BOT_TOKEN as a Worker Secret or encrypted admin secret."));

  const sourceKeys = new Map<string, string>();
  for (const route of routes) {
    const key = `${route.sourceChatId}:${route.sourceThreadId}`;
    const duplicate = sourceKeys.get(key);
    if (duplicate && duplicate !== route.id) issues.push(issue("error", "routes", "duplicate_source_topic", "Two routes use the same source chat/topic.", "Give each source topic exactly one route.", route.id));
    sourceKeys.set(key, route.id);
    if (route.enabled && route.outputs.filter((output) => output.enabled).length === 0) issues.push(issue("error", "routes", "enabled_route_has_no_outputs", "Enabled route has no enabled outputs.", "Add at least one enabled language output or disable the route.", route.id));
    for (const output of route.outputs) {
      if (output.enabled && output.publishEnabled && !output.finalChatId.trim()) issues.push(issue("error", "publishing", "final_channel_missing", "Enabled output is missing a final channel.", "Add a final channel/chat ID to the output.", route.id, output.id));
      if (output.enabled && output.signatureEnabled && !output.signatureText && !output.signatureChannelHandle) issues.push(issue("error", "signatures", "signature_content_missing", "Channel signature is enabled but empty.", "Add signature text or a public @channel handle.", route.id, output.id));
      if (output.signatureChannelHandle !== undefined && !/^@[A-Za-z0-9_]{5,32}$/.test(output.signatureChannelHandle)) issues.push(issue("error", "signatures", "signature_channel_handle_invalid", "Signature channel handle is invalid.", "Use a public Telegram handle that starts with @.", route.id, output.id));
    }
  }

  if (media.enabled) {
    if (!media.cacheChatId && !media.stagingChatId) issues.push(issue("error", "media", "media_cache_chat_missing", "Media processing is enabled but no cache/staging chat is configured.", "Set TELEGRAM_MEDIA_CACHE_CHAT_ID or TELEGRAM_MEDIA_STAGING_CHAT_ID."));
    if (!media.cacheThreadId && !media.stagingThreadId) issues.push(issue("warning", "media", "media_cache_topic_missing", "Media cache topic is not configured.", "Set TELEGRAM_MEDIA_CACHE_THREAD_ID so media does not appear in a source topic."));
    if (!media.github.repository || !media.github.workflowId || !media.github.ref) issues.push(issue("error", "media", "github_media_workflow_incomplete", "GitHub media workflow config is incomplete.", "Set repository, workflow ID, and ref for the media processor."));
    if (!secrets.mediaProcessorToken) issues.push(issue("error", "media", "media_processor_token_missing", "Media processor GitHub token is missing.", "Set MEDIA_PROCESSOR_GH_TOKEN or GITHUB_MEDIA_PROCESSOR_TOKEN."));
  }

  if (env.TELEGRAM_FINAL_PUBLISH_ENABLED === "true" && env.TELEGRAM_PUBLISH_SCHEDULER_ENABLED !== "true") {
    issues.push(issue("warning", "publishing", "publish_scheduler_disabled", "Final publishing is enabled but publish scheduler is disabled.", "Enable TELEGRAM_PUBLISH_SCHEDULER_ENABLED or run due publishing manually from the dashboard."));
  }

  const aiProvider = env.AI_PROVIDER ?? "mock";
  if (aiProvider !== "mock" && !hasConfiguredAiCredential(env, aiProvider)) issues.push(issue("error", "ai", "ai_credential_missing", "A real AI provider is selected but no matching credential is configured.", "Configure the provider API key as an encrypted admin secret or Worker Secret."));

  const promptSummary = await safePromptSummary(env);
  if (promptSummary.activeProfiles === 0) issues.push(issue("warning", "prompts", "active_prompts_missing", "No active Prompt Studio profiles were found.", "Create or activate prompt profiles so category/language outputs can use managed prompts. Code defaults remain as fallback."));
  if (routes.some((route) => route.outputs.some((output) => output.enabled)) && promptSummary.bindings === 0) issues.push(issue("info", "prompts", "prompt_bindings_missing", "No prompt bindings are configured.", "Bind active prompts to route outputs for predictable language/category behavior. Code defaults are still used as fallback."));

  return { valid: issues.filter((entry) => entry.severity === "error").length === 0, issues };
}

function readMediaSettings(env: Env): AdminMediaSettings {
  const mode = env.MEDIA_PROCESSING_MODE ?? "telegram_file_id_reuse";
  const enabled = mode === "github_actions" || env.GITHUB_MEDIA_PROCESSOR_ENABLED === "true" || env.GITHUB_MEDIA_WORKFLOW_ENABLED === "true";
  return {
    mode,
    enabled,
    cacheChatId: env.TELEGRAM_MEDIA_CACHE_CHAT_ID ?? "",
    cacheThreadId: env.TELEGRAM_MEDIA_CACHE_THREAD_ID ?? "",
    stagingChatId: env.TELEGRAM_MEDIA_STAGING_CHAT_ID ?? "",
    stagingThreadId: env.TELEGRAM_MEDIA_STAGING_THREAD_ID ?? "",
    maxPhotoMb: readInteger(env.TELEGRAM_MEDIA_MAX_PHOTO_MB, 9),
    maxFileMb: readInteger(env.TELEGRAM_MEDIA_MAX_FILE_MB, 49),
    maxAssets: readInteger(env.TELEGRAM_MEDIA_MAX_ASSETS ?? env.MEDIA_MAX_ASSETS, 10),
    reviewWaitMode: env.MEDIA_REVIEW_WAIT_MODE ?? "all_terminal",
    reviewAllowPartial: env.MEDIA_REVIEW_ALLOW_PARTIAL === "true",
    finalRequireReady: env.MEDIA_FINAL_REQUIRE_READY !== "false",
    finalAllowTextFallback: env.MEDIA_FINAL_ALLOW_TEXT_FALLBACK === "true",
    aspectDriftThreshold: readNumber(env.MEDIA_ASPECT_DRIFT_THRESHOLD, 0.02),
    fallbackProviderConfigured: Boolean(env.MEDIA_FALLBACK_PROVIDER_ENDPOINT?.trim()),
    fallbackProviders: {
      enabled: env.MEDIA_FALLBACK_ENABLED !== "false",
      xOrder: env.MEDIA_FALLBACK_PROVIDER_ORDER_X ?? "direct,gallery_dl,yt_dlp,external",
      instagramOrder: env.MEDIA_FALLBACK_PROVIDER_ORDER_INSTAGRAM ?? "direct,gallery_dl,instaloader,yt_dlp,external",
      galleryDlEnabled: env.MEDIA_GALLERY_DL_ENABLED !== "false",
      instaloaderEnabled: env.MEDIA_INSTALOADER_ENABLED !== "false"
    },
    videoOutput: {
      profile: env.MEDIA_VIDEO_OUTPUT_PROFILE ?? "telegram_review_optimized",
      transcodePolicy: env.MEDIA_VIDEO_TRANSCODE_POLICY ?? "copy_if_possible",
      maxSide: readInteger(env.MEDIA_MAX_VIDEO_SIDE, 1920),
      crf: readInteger(env.MEDIA_VIDEO_CRF, 23),
      audioBitrate: env.MEDIA_VIDEO_AUDIO_BITRATE ?? "128k"
    },
    github: {
      enabled: env.GITHUB_MEDIA_PROCESSOR_ENABLED === "true" || env.GITHUB_MEDIA_WORKFLOW_ENABLED === "true",
      repository: env.GITHUB_MEDIA_PROCESSOR_REPOSITORY ?? env.GITHUB_MEDIA_REPO ?? "",
      workflowId: env.GITHUB_MEDIA_PROCESSOR_WORKFLOW_ID ?? env.GITHUB_MEDIA_WORKFLOW_ID ?? "media-processor.yml",
      ref: env.GITHUB_MEDIA_PROCESSOR_REF ?? env.GITHUB_MEDIA_WORKFLOW_REF ?? "main",
      callbackUrl: env.GITHUB_MEDIA_PROCESSOR_CALLBACK_URL ?? ""
    }
  };
}

function normalizeMediaSettingsPatch(body: MediaSettingsPatch): { ok: true; updates: SetAdminConfigInput[] } | { ok: false; error: string; message: string } {
  const rawUpdates = Array.isArray(body.updates)
    ? body.updates
    : Object.entries(body).filter(([key]) => MEDIA_SETTING_KEYS.has(key)).map(([key, value]) => ({ key, value }));
  const updates = rawUpdates.filter((update): update is SetAdminConfigInput => typeof update === "object" && update !== null && typeof (update as { key?: unknown }).key === "string" && MEDIA_SETTING_KEYS.has((update as { key: string }).key));
  if (updates.length === 0) return { ok: false, error: "invalid_media_settings", message: "Provide at least one editable media setting." };
  return { ok: true, updates };
}

async function safeRecentMediaJobs(env: Env, limit: number): Promise<unknown[]> {
  try { return await new MediaProcessingJobsRepository(env.DB).listRecent(limit); } catch { return []; }
}

async function safeRecentPublishQueue(env: Env, limit: number): Promise<unknown[]> {
  try { return await new TelegramPublishQueueRepository(env.DB).listRecent(limit); } catch { return []; }
}

async function countByDateBucket(db: D1Database, tableName: "telegram_generated_outputs" | "telegram_publish_queue" | "media_processing_jobs", dateColumn: "created_at" | "updated_at", days: number, extraWhere?: string): Promise<Array<{ day: string; count: number }>> {
  const safeDays = Math.max(1, Math.min(Math.floor(days), 90));
  const since = new Date(Date.now() - safeDays * 24 * 60 * 60 * 1000).toISOString();
  return countByDay(db, tableName, dateColumn, since, extraWhere);
}

async function countByDay(db: D1Database, tableName: "telegram_generated_outputs" | "telegram_publish_queue" | "media_processing_jobs", dateColumn: string, sinceIso: string, extraWhere?: string): Promise<Array<{ day: string; count: number }>> {
  try {
    const safeDateColumn = dateColumn === "created_at" || dateColumn === "updated_at" ? dateColumn : "created_at";
    const where = `${safeDateColumn} >= ?${extraWhere ? ` AND ${extraWhere}` : ""}`;
    const result = await db.prepare(`SELECT substr(${safeDateColumn}, 1, 10) AS day, COUNT(*) AS count FROM ${tableName} WHERE ${where} GROUP BY day ORDER BY day ASC`).bind(sinceIso).all<{ day: string; count: number }>();
    return result.results ?? [];
  } catch {
    return [];
  }
}

async function countByColumn(db: D1Database, tableName: string, columnName: string): Promise<Record<string, number>> {
  if (!/^[a-z_]+$/.test(tableName) || !/^[a-z_]+$/.test(columnName)) return {};
  try {
    const result = await db.prepare(`SELECT ${columnName} AS key, COUNT(*) AS count FROM ${tableName} GROUP BY ${columnName}`).all<{ key: string; count: number }>();
    return Object.fromEntries((result.results ?? []).map((row) => [row.key, row.count]));
  } catch {
    return {};
  }
}


async function safePromptSummary(env: Env): Promise<{ profiles: number; activeProfiles: number; bindings: number; enabledBindings: number }> {
  try {
    const repository = new PromptProfilesRepository(env.DB);
    const profiles = await repository.listProfiles();
    const bindings = await repository.listBindings();
    return { profiles: profiles.length, activeProfiles: profiles.filter((profile) => profile.status === "active").length, bindings: bindings.length, enabledBindings: bindings.filter((binding) => binding.enabled).length };
  } catch {
    return { profiles: 0, activeProfiles: 0, bindings: 0, enabledBindings: 0 };
  }
}

function readEnvironmentDetails(env: Env, serviceName: string): Record<string, unknown> {
  const environment = env.ENVIRONMENT ?? "unknown";
  const inferredDatabaseName = env.D1_DATABASE_NAME
    ?? (environment === "staging" ? "curator_mvp_staging" : environment === "production" ? "curator_mvp" : "curator_mvp");
  const databaseId = env.D1_DATABASE_ID;
  return {
    environment,
    workerName: env.WORKER_NAME ?? serviceName,
    publicBaseUrl: env.WORKER_PUBLIC_BASE_URL ?? "",
    d1: {
      binding: "DB",
      databaseName: inferredDatabaseName,
      databaseIdShort: databaseId === undefined ? "unknown" : `${databaseId.slice(0, 4)}...${databaseId.slice(-4)}`
    },
    safety: {
      staging: environment === "staging",
      production: environment === "production",
      destructiveToolsEnabled: environment === "staging"
    }
  };
}

function readSecretSources(rawEnv: Env, effectiveEnv: Env): Record<string, string> {
  const definitions: Array<{ label: string; keys: string[] }> = [
    { label: "internalApiSecret", keys: ["INTERNAL_API_SECRET"] },
    { label: "configEncryptionKey", keys: ["CONFIG_ENCRYPTION_KEY"] },
    { label: "telegramBotToken", keys: ["TELEGRAM_BOT_TOKEN"] },
    { label: "telegramWebhookSecret", keys: ["TELEGRAM_WEBHOOK_SECRET"] },
    { label: "aiApiKey", keys: ["AI_API_KEY"] },
    { label: "openaiApiKey", keys: ["OPENAI_API_KEY"] },
    { label: "geminiApiKey", keys: ["GEMINI_API_KEY"] },
    { label: "customAiApiKey", keys: ["CUSTOM_AI_API_KEY"] },
    { label: "mediaProcessorToken", keys: ["MEDIA_PROCESSOR_GH_TOKEN", "GITHUB_MEDIA_PROCESSOR_TOKEN", "GITHUB_TOKEN"] },
    { label: "wordpressApplicationPassword", keys: ["WORDPRESS_APPLICATION_PASSWORD"] },
    { label: "firecrawlApiKey", keys: ["FIRECRAWL_API_KEY"] },
    { label: "apifyToken", keys: ["APIFY_TOKEN"] },
    { label: "getxapiKey", keys: ["GETXAPI_KEY"] }
  ];
  return Object.fromEntries(definitions.map((definition) => [definition.label, sourceForSecret(rawEnv, effectiveEnv, definition.keys)]));
}

function sourceForSecret(rawEnv: Env, effectiveEnv: Env, keys: string[]): string {
  const rawHasValue = keys.some((key) => hasValue((rawEnv as unknown as Record<string, string | undefined>)[key]));
  const effectiveHasValue = keys.some((key) => hasValue((effectiveEnv as unknown as Record<string, string | undefined>)[key]));
  if (rawHasValue && effectiveHasValue) return "env_or_worker_secret";
  if (effectiveHasValue) return "encrypted_d1_override";
  return "missing";
}

function readConfiguredSecrets(env: Env): Record<string, boolean> {
  return {
    internalApiSecret: hasValue(env.INTERNAL_API_SECRET),
    configEncryptionKey: hasValue(env.CONFIG_ENCRYPTION_KEY),
    telegramBotToken: hasValue(env.TELEGRAM_BOT_TOKEN),
    telegramWebhookSecret: hasValue(env.TELEGRAM_WEBHOOK_SECRET),
    aiApiKey: hasValue(env.AI_API_KEY),
    openaiApiKey: hasValue(env.OPENAI_API_KEY),
    geminiApiKey: hasValue(env.GEMINI_API_KEY),
    customAiApiKey: hasValue(env.CUSTOM_AI_API_KEY),
    mediaProcessorToken: hasValue((env as Env & { MEDIA_PROCESSOR_GH_TOKEN?: string }).MEDIA_PROCESSOR_GH_TOKEN) || hasValue(env.GITHUB_MEDIA_PROCESSOR_TOKEN) || hasValue(env.GITHUB_TOKEN),
    wordpressApplicationPassword: hasValue(env.WORDPRESS_APPLICATION_PASSWORD),
    firecrawlApiKey: hasValue(env.FIRECRAWL_API_KEY),
    apifyToken: hasValue(env.APIFY_TOKEN),
    getxapiKey: hasValue(env.GETXAPI_KEY)
  };
}

function buildReadiness(issues: AdminIssue[]): Record<string, unknown> {
  const errors = issues.filter((entry) => entry.severity === "error").length;
  const warnings = issues.filter((entry) => entry.severity === "warning").length;
  const label = errors > 0 ? "blocked" : warnings > 0 ? "needs_attention" : "ready";
  return { label, errors, warnings, score: Math.max(0, 100 - errors * 25 - warnings * 8) };
}

function issue(severity: AdminIssueSeverity, area: string, code: string, message: string, action: string, routeId?: string, outputId?: string): AdminIssue {
  return { severity, area, code, message, action, ...(routeId === undefined ? {} : { routeId }), ...(outputId === undefined ? {} : { outputId }) };
}

function hasConfiguredAiCredential(env: Env, provider: string): boolean {
  if (hasValue(env.AI_API_KEY)) return true;
  if (provider === "openai") return hasValue(env.OPENAI_API_KEY);
  if (provider === "gemini") return hasValue(env.GEMINI_API_KEY);
  if (provider === "custom") return hasValue(env.CUSTOM_AI_API_KEY);
  return true;
}

function readNumber(value: string | undefined, fallback: number): number {
  const parsed = value === undefined ? NaN : Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readInteger(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim().length === 0) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function hasValue(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
