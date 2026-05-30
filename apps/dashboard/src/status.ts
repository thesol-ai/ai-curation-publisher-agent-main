import type { ApiResult, ChecklistItem, JsonObject, StatusBundle } from "./types";

export type ManagerSummary = {
  healthLabel: "Healthy" | "Warning" | "Not ready";
  operatingMode: string;
  safeNow: string[];
  missing: string[];
  nextAction: string;
};

export function buildManagerSummary(bundle: StatusBundle): ManagerSummary {
  const statusData = asObject(bundle.status);
  const readyData = asObject(bundle.ready);
  const healthOk = bundle.health?.ok === true;
  const readyOk = bundle.ready?.ok === true;
  const mockMode = readBoolean(statusData, ["mockMode"]);
  const scheduler = asNested(statusData, "scheduler");
  const providers = asNested(statusData, "providers");
  const wordpress = asNested(statusData, "wordpress");
  const telegram = asNested(statusData, "telegram");
  const pilot = asNested(statusData, "pilot");
  const warnings = readArray(readyData, ["warnings"]);
  const errors = readArray(readyData, ["errors"]);

  const safeNow: string[] = [];
  const missing: string[] = [];

  if (mockMode) {
    safeNow.push("The system is running with mock-safe defaults.");
  }

  if (readBoolean(scheduler, ["enabled"]) !== true) {
    safeNow.push("Scheduler is disabled, which is safe for MVP operation.");
  }

  if (readBoolean(scheduler, ["publishingAllowed"]) !== true) {
    safeNow.push("Automatic publishing is not allowed by scheduler settings.");
  }

  if (readBoolean(providers, ["mode"]) === false) {
    missing.push("Provider mode was not reported by the backend.");
  }

  if (readBoolean(telegram, ["realReviewEnabled"]) !== true) {
    missing.push("Telegram real review dry-run is not enabled.");
  }

  if (readBoolean(wordpress, ["realDryRunEnabled"]) !== true) {
    missing.push("WordPress real draft dry-run is not enabled.");
  }

  if (readBoolean(pilot, ["ready"]) !== true) {
    missing.push("Controlled pilot is not fully configured for real integration checks.");
  }

  const healthLabel = healthOk && readyOk && errors.length === 0
    ? "Healthy"
    : healthOk && warnings.length > 0
      ? "Warning"
      : "Not ready";

  const operatingMode = mockMode
    ? "Mock / dry-run safe"
    : readBoolean(scheduler, ["enabled"]) === true
      ? "Scheduler configured"
      : "Pilot-ready or production-blocked";

  return {
    healthLabel,
    operatingMode,
    safeNow: safeNow.length > 0 ? safeNow : ["No public publishing action is enabled from the dashboard."],
    missing,
    nextAction: chooseNextAction({ healthOk, readyOk, errors, warnings, pilotReady: readBoolean(pilot, ["ready"]) === true })
  };
}

export function buildChecklist(bundle: StatusBundle): Record<string, ChecklistItem[]> {
  const statusData = asObject(bundle.status);
  const telegram = asNested(statusData, "telegram");
  const wordpress = asNested(statusData, "wordpress");
  const scheduler = asNested(statusData, "scheduler");
  const quotas = asNested(statusData, "quotas");
  const pilot = asNested(statusData, "pilot");

  return {
    Core: [
      item("INTERNAL_API_SECRET", "Protects internal routes", "local .dev.vars or Cloudflare Worker Secret", true),
      item("ENVIRONMENT", "Labels the runtime environment", "local .dev.vars or Cloudflare Worker Variable", false, readString(statusData, ["environment"]) !== undefined),
      item("LOG_LEVEL", "Controls runtime logging level", "local .dev.vars or Cloudflare Worker Variable", false)
    ],
    Providers: [
      item("PROVIDERS_MODE", "Controls provider mode", "local .dev.vars or Cloudflare Worker Variable", false, readString(asNested(statusData, "providers"), ["mode"]) !== undefined),
      item("ENABLE_FIRECRAWL_PROVIDER", "Enables Firecrawl sandbox provider", "Cloudflare Worker Variable", false, readBoolean(pilot, ["firecrawlConfigured"])),
      item("FIRECRAWL_API_KEY", "Allows Firecrawl sandbox calls", "Cloudflare Worker Secret", true, readBoolean(pilot, ["firecrawlConfigured"])),
      item("APIFY_TOKEN", "Future Apify provider credential", "Cloudflare Worker Secret", true),
      item("GETXAPI_KEY", "Future X provider credential", "Cloudflare Worker Secret", true)
    ],
    Telegram: [
      item("TELEGRAM_BOT_TOKEN", "Allows Telegram Bot API calls", "Cloudflare Worker Secret", true, readBoolean(telegram, ["botTokenConfigured"])),
      item("TELEGRAM_WEBHOOK_SECRET", "Verifies Telegram webhook where configured", "Cloudflare Worker Secret", true),
      item("TELEGRAM_REVIEW_CHAT_ID", "Target for review messages", "Cloudflare Worker Secret or Variable", true, readBoolean(telegram, ["reviewChatConfigured"])),
      item("TELEGRAM_FINAL_CHAT_ID", "Target for final channel publishing", "Cloudflare Worker Secret or Variable", true, readBoolean(telegram, ["finalChatConfigured"])),
      item("TELEGRAM_REAL_REVIEW_ENABLED", "Enables real review dry-run", "Cloudflare Worker Variable", false, readBoolean(telegram, ["realReviewEnabled"]))
    ],
    WordPress: [
      item("WORDPRESS_BASE_URL", "WordPress site URL", "Cloudflare Worker Variable or Secret", true, readBoolean(wordpress, ["baseUrlConfigured"])),
      item("WORDPRESS_USERNAME", "WordPress REST username", "Cloudflare Worker Secret", true, readBoolean(wordpress, ["credentialsConfigured"])),
      item("WORDPRESS_APPLICATION_PASSWORD", "WordPress REST application password", "Cloudflare Worker Secret", true, readBoolean(wordpress, ["credentialsConfigured"])),
      item("WORDPRESS_DEFAULT_STATUS", "Default WordPress post status", "Cloudflare Worker Variable", false, readString(wordpress, ["defaultStatus"]) !== undefined),
      item("WORDPRESS_REAL_DRY_RUN_ENABLED", "Enables real WordPress draft dry-run", "Cloudflare Worker Variable", false, readBoolean(wordpress, ["realDryRunEnabled"]))
    ],
    Scheduler: [
      item("SCHEDULER_ENABLED", "Controls scheduler execution", "Cloudflare Worker Variable", false, readBoolean(scheduler, ["enabled"])),
      item("SCHEDULER_DRY_RUN", "Keeps scheduler in dry-run mode", "Cloudflare Worker Variable", false, readBoolean(scheduler, ["dryRun"])),
      item("SCHEDULER_ALLOW_REAL_PROVIDERS", "Allows real providers from scheduler", "Cloudflare Worker Variable", false, readBoolean(scheduler, ["realProvidersAllowed"])),
      item("SCHEDULER_ALLOW_PUBLISHING", "Allows scheduler publishing", "Cloudflare Worker Variable", false, readBoolean(scheduler, ["publishingAllowed"])),
      item("SCHEDULER_MAX_SOURCES_PER_RUN", "Limits scheduler sources", "Cloudflare Worker Variable", false, readNumber(scheduler, ["maxSourcesPerRun"]) !== undefined),
      item("SCHEDULER_MAX_ITEMS_PER_RUN", "Limits scheduler items", "Cloudflare Worker Variable", false, readNumber(scheduler, ["maxItemsPerRun"]) !== undefined)
    ],
    Quotas: [
      item("MAX_AI_ITEMS_PER_RUN", "Limits AI items per run", "Cloudflare Worker Variable", false, readNumber(quotas, ["maxAiItemsPerRun"]) !== undefined),
      item("MAX_PROVIDER_ITEMS_PER_RUN", "Limits provider items per run", "Cloudflare Worker Variable", false, readNumber(quotas, ["maxProviderItemsPerRun"]) !== undefined),
      item("MAX_PUBLISH_ITEMS_PER_RUN", "Limits publish items per run", "Cloudflare Worker Variable", false, readNumber(quotas, ["maxPublishItemsPerRun"]) !== undefined)
    ],
    "Cloudflare/GitHub": [
      item("CLOUDFLARE_API_TOKEN", "Allows GitHub Actions deploy/migration workflows", "GitHub Actions Secret", true),
      item("CLOUDFLARE_ACCOUNT_ID", "Identifies Cloudflare account for workflows", "GitHub Actions Secret", true)
    ]
  };
}

export function countWarnings(value: unknown): number {
  if (!isRecord(value)) {
    return 0;
  }
  const warnings = value.warnings;
  return Array.isArray(warnings) ? warnings.length : 0;
}

export function countErrors(value: unknown): number {
  if (!isRecord(value)) {
    return 0;
  }
  const errors = value.errors;
  if (Array.isArray(errors)) {
    return errors.length;
  }
  return value.ok === false ? 1 : 0;
}

function chooseNextAction(input: { healthOk: boolean; readyOk: boolean; errors: string[]; warnings: string[]; pilotReady: boolean }): string {
  if (!input.healthOk) {
    return "Set the Worker API URL and verify /health first.";
  }
  if (!input.readyOk || input.errors.length > 0) {
    return "Review readiness errors before running any pilot checks.";
  }
  if (!input.pilotReady) {
    return "Run the controlled pilot readiness-only check, then configure optional integrations manually if needed.";
  }
  if (input.warnings.length > 0) {
    return "Review warnings, then run mock E2E smoke before any real integration pilot.";
  }
  return "Run mock E2E smoke, then use optional pilot checks only when intentionally configured.";
}

function item(name: string, purpose: string, where: string, sensitive: boolean, configured?: boolean): ChecklistItem {
  return { name, purpose, where, sensitive, ...(configured === undefined ? {} : { configured }) };
}

function asObject(result: ApiResult | undefined): JsonObject {
  return result?.ok === true && isRecord(result.data) ? result.data : {};
}

function asNested(value: JsonObject, key: string): JsonObject {
  const nested = value[key];
  return isRecord(nested) ? nested : {};
}

function readBoolean(value: JsonObject, path: string[]): boolean | undefined {
  const nested = readPath(value, path);
  return typeof nested === "boolean" ? nested : undefined;
}

function readString(value: JsonObject, path: string[]): string | undefined {
  const nested = readPath(value, path);
  return typeof nested === "string" ? nested : undefined;
}

function readNumber(value: JsonObject, path: string[]): number | undefined {
  const nested = readPath(value, path);
  return typeof nested === "number" ? nested : undefined;
}

function readArray(value: JsonObject, path: string[]): string[] {
  const nested = readPath(value, path);
  return Array.isArray(nested) ? nested.filter((item): item is string => typeof item === "string") : [];
}

function readPath(value: JsonObject, path: string[]): unknown {
  let current: unknown = value;
  for (const part of path) {
    if (!isRecord(current)) {
      return undefined;
    }
    current = current[part];
  }
  return current;
}

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
