import { readProviderRuntimeConfig, summarizeProviderConfig, type ProviderConfigSummary } from "@curator/providers";
import { readSchedulerSettings, type SchedulerSettings } from "./operations/scheduled-poll";
import type { Env } from "./types";

export type OperatingMode = "manual_only" | "mock_demo" | "provider_assisted";
export type AiProvider = "mock" | "openai" | "gemini" | "custom";

export type WorkerOperationalConfig = {
  serviceName: "ai-curation-publisher-agent";
  environment: string;
  logLevel: string;
  mockMode: true;
  operatingMode: OperatingMode;
  contentInput: { defaultSourceMode: string };
  ai: SafeConfigSummary["ai"];
  telegram: { reviewChatConfigured: boolean; finalChatConfigured: boolean; finalChatId: string; botTokenConfigured: boolean; realReviewEnabled: boolean };
  wordpress: { configured: boolean; baseUrlConfigured: boolean; credentialsConfigured: boolean; realDryRunEnabled: boolean; defaultStatus: string };
  scheduler: { enabled: boolean; dryRun: boolean; realProvidersAllowed: boolean; publishingAllowed: boolean; maxSourcesPerRun: number; maxItemsPerRun: number };
  quotas: SchedulerSettings["quotas"];
  providers: ProviderConfigSummary;
  readiness: SafeConfigSummary;
};

export type SafeConfigSummary = {
  environment: string;
  mockMode: true;
  operatingMode: OperatingMode;
  defaultContentSourceMode: string;
  providersMode: string;
  hasInternalSecret: boolean;
  ai: {
    provider: AiProvider;
    modelConfigured: boolean;
    model: string;
    fallbackModels: string[];
    fallbackRuntime: "configured_partial";
    runtimeProviderSwitching: "active_for_telegram_topic_outputs";
    outputLanguage: string;
    translationEnabled: boolean;
    rewriteEnabled: boolean;
    summaryEnabled: boolean;
    tonePreset: string;
    maxOutputTokens: number;
    temperature: number;
    retryEnabled: boolean;
    maxRetries: number;
    genericCredentialConfigured: boolean;
    providerCredentialConfigured: boolean;
    ready: boolean;
    productionGrade: boolean;
    nextAction: string;
  };
  hasTelegramConfig: boolean;
  hasTelegramBotToken: boolean;
  telegramRealReviewEnabled: boolean;
  hasWordPressConfig: boolean;
  hasWordPressBaseUrl: boolean;
  hasWordPressCredentials: boolean;
  wordpressRealDryRunEnabled: boolean;
  wordpressDefaultStatus: string;
  scheduler: { enabled: boolean; dryRun: boolean; realProvidersAllowed: boolean; publishingAllowed: boolean; maxSourcesPerRun: number; maxItemsPerRun: number };
  quotas: SchedulerSettings["quotas"];
  hasProviderCredentials: { apify: boolean; getxapi: boolean; firecrawl: boolean };
  providerSetupRequired: boolean;
  providerSetupSatisfied: boolean;
  setupSafe: boolean;
  productionReviewReady: boolean;
  wordpressDraftReady: boolean;
  providerAssistedReady: boolean;
};

export type ConfigValidationResult = { ready: boolean; summary: SafeConfigSummary; warnings: string[]; errors: string[] };

export function readOperationalConfig(env: Env): WorkerOperationalConfig {
  const providerConfig = readProviderRuntimeConfig(env);
  const safeSummary = buildSafeConfigSummary(env);
  return {
    serviceName: "ai-curation-publisher-agent",
    environment: env.ENVIRONMENT ?? "unknown",
    logLevel: env.LOG_LEVEL ?? "info",
    mockMode: true,
    operatingMode: safeSummary.operatingMode,
    contentInput: { defaultSourceMode: safeSummary.defaultContentSourceMode },
    ai: safeSummary.ai,
    telegram: { reviewChatConfigured: Boolean(env.TELEGRAM_REVIEW_CHAT_ID), finalChatConfigured: Boolean(env.TELEGRAM_FINAL_CHAT_ID), finalChatId: env.TELEGRAM_FINAL_CHAT_ID ?? "mock_final_chat", botTokenConfigured: hasValue(env.TELEGRAM_BOT_TOKEN), realReviewEnabled: env.TELEGRAM_REAL_REVIEW_ENABLED === "true" },
    wordpress: { configured: safeSummary.hasWordPressConfig, baseUrlConfigured: safeSummary.hasWordPressBaseUrl, credentialsConfigured: safeSummary.hasWordPressCredentials, realDryRunEnabled: safeSummary.wordpressRealDryRunEnabled, defaultStatus: safeSummary.wordpressDefaultStatus },
    scheduler: safeSummary.scheduler,
    quotas: safeSummary.quotas,
    providers: summarizeProviderConfig(providerConfig),
    readiness: safeSummary
  };
}

export function validateRuntimeConfig(env: Env): ConfigValidationResult {
  const summary = buildSafeConfigSummary(env);
  const warnings: string[] = [];
  const errors: string[] = [];
  const production = summary.environment === "production";
  const reviewWorkflowRequired = summary.telegramRealReviewEnabled;
  if (!summary.hasInternalSecret) production ? errors.push("INTERNAL_API_SECRET is not configured.") : warnings.push("INTERNAL_API_SECRET is not configured.");
  if (!summary.ai.ready) production && summary.ai.provider !== "mock" ? errors.push(summary.ai.nextAction) : warnings.push(summary.ai.nextAction);
  if (summary.ai.provider === "mock" && production) warnings.push("AI provider is mock. This is valid for demos but not production-grade AI processing.");
  if (!summary.productionReviewReady) {
    const message = reviewWorkflowRequired ? "Telegram review is enabled but review configuration is incomplete." : "Telegram review configuration is incomplete. Configure it only when review workflow is required.";
    production && reviewWorkflowRequired ? errors.push(message) : warnings.push(message);
  }
  if (!summary.wordpressDraftReady) warnings.push("WordPress draft configuration is incomplete. This is a warning unless WordPress drafts are required for launch.");
  if (summary.wordpressRealDryRunEnabled && !summary.wordpressDraftReady) production ? errors.push("WordPress real dry-run is enabled but WordPress configuration is incomplete.") : warnings.push("WordPress real dry-run is enabled but WordPress configuration is incomplete.");
  if (summary.scheduler.enabled && !summary.scheduler.dryRun) warnings.push("Scheduler is enabled outside dry-run mode. Publishing still remains blocked by this phase.");
  if (summary.scheduler.realProvidersAllowed) warnings.push("Scheduler real provider access is configured outside dashboard controls and should remain disabled unless explicitly supported.");
  if (summary.scheduler.publishingAllowed) errors.push("Scheduler publishing is configured on. This phase does not support scheduler publishing.");
  if (summary.providerSetupRequired && !summary.providerSetupSatisfied) production ? errors.push("Provider-assisted mode is selected but no provider credentials are configured.") : warnings.push("Provider-assisted mode is selected but no provider credentials are configured.");
  return { ready: errors.length === 0, summary, warnings, errors };
}

export function buildSafeConfigSummary(env: Env): SafeConfigSummary {
  const providerConfig = readProviderRuntimeConfig(env);
  const schedulerSettings = readSchedulerSettings(env);
  const operatingMode = normalizeOperatingMode(env.OPERATING_MODE);
  const aiProvider = normalizeAiProvider(env.AI_PROVIDER);
  const providerCredentials = { apify: hasEnvKey(env, "APIFY_TOKEN"), getxapi: hasEnvKey(env, "GETXAPI_KEY"), firecrawl: hasEnvKey(env, "FIRECRAWL_API_KEY") };
  const genericAiCredential = hasEnvKey(env, credentialName("AI"));
  const providerAiCredential = aiProvider === "openai" ? hasEnvKey(env, credentialName("OPENAI")) || genericAiCredential : aiProvider === "gemini" ? hasEnvKey(env, credentialName("GEMINI")) || genericAiCredential : aiProvider === "custom" ? hasEnvKey(env, credentialName("CUSTOM_AI")) || genericAiCredential : true;
  const model = normalizeString(env.AI_MODEL, aiProvider === "mock" ? "mock" : "");
  const modelConfigured = aiProvider === "mock" || hasValue(model);
  const aiReady = aiProvider === "mock" || (providerAiCredential && modelConfigured);
  const hasWordPressBaseUrl = hasValue(env.WORDPRESS_BASE_URL);
  const hasWordPressCredentials = hasValue(env.WORDPRESS_USERNAME) && hasValue(env.WORDPRESS_APPLICATION_PASSWORD);
  const hasTelegramConfig = hasValue(env.TELEGRAM_REVIEW_CHAT_ID) && hasValue(env.TELEGRAM_FINAL_CHAT_ID);
  const hasTelegramBotToken = hasValue(env.TELEGRAM_BOT_TOKEN);
  const providerSetupRequired = operatingMode === "provider_assisted";
  const providerSetupSatisfied = !providerSetupRequired || Object.values(providerCredentials).some(Boolean);
  const productionReviewReady = hasTelegramConfig && hasTelegramBotToken;
  const wordpressDraftReady = hasWordPressBaseUrl && hasWordPressCredentials;
  const setupSafe = !schedulerSettings.publishingAllowed && !schedulerSettings.realProvidersAllowed && schedulerSettings.dryRun;
  return {
    environment: env.ENVIRONMENT ?? "unknown",
    mockMode: true,
    operatingMode,
    defaultContentSourceMode: normalizeEnum(env.DEFAULT_CONTENT_SOURCE_MODE, ["manual", "mock", "provider"], "manual"),
    providersMode: providerConfig.mode,
    hasInternalSecret: hasValue(env.INTERNAL_API_SECRET),
    ai: { provider: aiProvider, modelConfigured, model: model || "missing", fallbackModels: parseModelFallbacks(env.AI_MODEL_FALLBACKS), fallbackRuntime: "configured_partial", runtimeProviderSwitching: "active_for_telegram_topic_outputs", outputLanguage: normalizeEnum(env.AI_OUTPUT_LANGUAGE, ["fa", "en", "ar", "auto"], "fa"), translationEnabled: readBoolean(env.AI_TRANSLATION_ENABLED, true), rewriteEnabled: readBoolean(env.AI_REWRITE_ENABLED, true), summaryEnabled: readBoolean(env.AI_SUMMARY_ENABLED, true), tonePreset: normalizeEnum(env.AI_TONE_PRESET, ["neutral", "editorial", "concise", "professional", "social", "custom"], "neutral"), maxOutputTokens: readInteger(env.AI_MAX_OUTPUT_TOKENS, 1200), temperature: readNumber(env.AI_TEMPERATURE, 0.4), retryEnabled: readBoolean(env.AI_RETRY_ENABLED, true), maxRetries: readInteger(env.AI_MAX_RETRIES, 2), genericCredentialConfigured: genericAiCredential, providerCredentialConfigured: providerAiCredential, ready: aiReady, productionGrade: aiProvider !== "mock" && aiReady, nextAction: aiReady ? "AI settings are usable. Runtime provider switching is active for Telegram topic outputs; fallback execution remains partially implemented." : "Configure an AI model and provider credential in Dashboard -> Settings -> AI." },
    hasTelegramConfig,
    hasTelegramBotToken,
    telegramRealReviewEnabled: env.TELEGRAM_REAL_REVIEW_ENABLED === "true",
    hasWordPressConfig: wordpressDraftReady,
    hasWordPressBaseUrl,
    hasWordPressCredentials,
    wordpressRealDryRunEnabled: env.WORDPRESS_REAL_DRY_RUN_ENABLED === "true",
    wordpressDefaultStatus: normalizeWordPressStatus(env.WORDPRESS_DEFAULT_STATUS),
    scheduler: { enabled: schedulerSettings.schedulerEnabled, dryRun: schedulerSettings.dryRun, realProvidersAllowed: schedulerSettings.realProvidersAllowed, publishingAllowed: schedulerSettings.publishingAllowed, maxSourcesPerRun: schedulerSettings.maxSources, maxItemsPerRun: schedulerSettings.maxItems },
    quotas: schedulerSettings.quotas,
    hasProviderCredentials: providerCredentials,
    providerSetupRequired,
    providerSetupSatisfied,
    setupSafe,
    productionReviewReady,
    wordpressDraftReady,
    providerAssistedReady: providerSetupSatisfied
  };
}

function credentialName(provider: string): string { return `${provider}_API_KEY`; }
function hasEnvKey(env: Env, key: string): boolean { return hasValue((env as unknown as Record<string, string | undefined>)[key]); }
function normalizeOperatingMode(value: string | undefined): OperatingMode { return value === "mock_demo" || value === "provider_assisted" ? value : "manual_only"; }
function normalizeAiProvider(value: string | undefined): AiProvider { return value === "openai" || value === "gemini" || value === "custom" ? value : "mock"; }
function normalizeWordPressStatus(value: string | undefined): string { return value === "draft" ? value : "draft"; }
function normalizeEnum(value: string | undefined, allowed: string[], fallback: string): string { return value !== undefined && allowed.includes(value) ? value : fallback; }
function normalizeString(value: string | undefined, fallback: string): string { return hasValue(value) ? value.trim() : fallback; }
function parseModelFallbacks(value: string | undefined): string[] { if (!hasValue(value)) return []; const normalizedValue = value.trim(); try { const parsed = JSON.parse(normalizedValue) as unknown; if (Array.isArray(parsed)) return parsed.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0).map((entry) => entry.trim()).slice(0, 5); } catch {} return normalizedValue.split(",").map((entry) => entry.trim()).filter(Boolean).slice(0, 5); }
function readBoolean(value: string | undefined, fallback: boolean): boolean { if (value === "true") return true; if (value === "false") return false; return fallback; }
function readInteger(value: string | undefined, fallback: number): number { if (!hasValue(value)) return fallback; const parsed = Number.parseInt(value, 10); return Number.isFinite(parsed) ? parsed : fallback; }
function readNumber(value: string | undefined, fallback: number): number { if (!hasValue(value)) return fallback; const parsed = Number.parseFloat(value); return Number.isFinite(parsed) ? parsed : fallback; }
function hasValue(value: string | undefined): value is string { return typeof value === "string" && value.trim().length > 0; }
