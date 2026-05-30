export const AI_PROVIDER_OPTIONS = [
  { value: "mock", label: "Mock, safe setup mode" },
  { value: "gemini", label: "Gemini" },
  { value: "openai", label: "OpenAI" },
  { value: "custom", label: "Custom provider" }
];

export const GEMINI_MODEL_PRESETS = ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.5-flash-lite"];
export const OPENAI_MODEL_PRESETS = ["gpt-5.5", "gpt-5.4", "gpt-5.4-mini", "gpt-5.4-nano"];

export function isCredentialKey(key: string): boolean {
  return key.endsWith("_API_KEY") || key.endsWith("_TOKEN") || key.endsWith("_WEBHOOK_SECRET") || key.endsWith("_APPLICATION_PASSWORD");
}

export function saveButtonLabel(key: string): string {
  return isCredentialKey(key) ? "Replace secret" : "Save setting";
}

export function friendlyFieldLabel(key: string, fallback: string): string {
  const labels: Record<string, string> = {
    OPERATING_MODE: "Operating mode",
    DEFAULT_CONTENT_SOURCE_MODE: "Content input mode",
    AI_PROVIDER: "AI provider",
    AI_MODEL: "Primary AI model",
    AI_MODEL_FALLBACKS: "Fallback models",
    AI_OUTPUT_LANGUAGE: "Output language",
    TELEGRAM_REVIEW_CHAT_ID: "Telegram review chat",
    TELEGRAM_FINAL_CHAT_ID: "Telegram final chat",
    TELEGRAM_REAL_REVIEW_ENABLED: "Telegram review enabled",
    WORDPRESS_BASE_URL: "WordPress site URL",
    WORDPRESS_USERNAME: "WordPress username",
    WORDPRESS_DEFAULT_STATUS: "WordPress default status",
    WORDPRESS_REAL_DRY_RUN_ENABLED: "WordPress draft dry-run",
    PROVIDERS_MODE: "Provider mode",
    FIRECRAWL_BASE_URL: "Firecrawl base URL",
    FIRECRAWL_TIMEOUT_MS: "Firecrawl timeout",
    SCHEDULER_DRY_RUN: "Scheduler dry-run",
    MAX_AI_ITEMS_PER_RUN: "Max AI items per run",
    MAX_PROVIDER_ITEMS_PER_RUN: "Max provider items per run",
    MAX_PUBLISH_ITEMS_PER_RUN: "Max publish items per run"
  };
  if (isCredentialKey(key)) return fallback.replace(/_/g, " ").toLowerCase();
  return labels[key] ?? fallback;
}

export function fieldHelpText(key: string, fallback: string): string {
  const help: Record<string, string> = {
    AI_PROVIDER: "Choose Mock for setup, Gemini if you have Gemini access, or OpenAI if you have OpenAI access.",
    AI_MODEL: "Provider chooses the company/service. Model chooses the specific AI model. Recommended start: gemini-2.5-flash.",
    AI_MODEL_FALLBACKS: "Optional. Add backup models in order, separated by commas. Example: gemini-2.5-flash-lite, gpt-5.4-mini.",
    TELEGRAM_REVIEW_CHAT_ID: "Where review messages should go. Usually a Telegram chat ID or channel/group ID.",
    TELEGRAM_FINAL_CHAT_ID: "Optional for later final publishing. Keep final publishing disabled during MVP.",
    WORDPRESS_BASE_URL: "Your WordPress site base URL. Example: https://example.com",
    WORDPRESS_USERNAME: "The WordPress user that owns draft creation.",
    WORDPRESS_DEFAULT_STATUS: "Keep this as draft for safe MVP launch.",
    PROVIDERS_MODE: "Optional in Manual-only mode. Skip unless you intentionally want automated external sources.",
    FIRECRAWL_BASE_URL: "Optional provider endpoint. Skip in Manual-only mode.",
    FIRECRAWL_TIMEOUT_MS: "Provider request timeout. Lower values reduce waiting time.",
    MAX_AI_ITEMS_PER_RUN: "Cost safety limit for AI work per run.",
    MAX_PROVIDER_ITEMS_PER_RUN: "Cost safety limit for provider items per run.",
    MAX_PUBLISH_ITEMS_PER_RUN: "Keep this at 0 until publishing is explicitly approved."
  };
  if (isCredentialKey(key)) return "Enter a new value only when replacing it. Saved values are encrypted and never shown again.";
  return help[key] ?? fallback;
}

export function stepStateClass(state: string, active: boolean): string {
  if (active) return "step-active";
  return `step-${state.replace("_", "-")}`;
}

export function stepStateLabel(state: string, optional: boolean, active: boolean): string {
  if (active) return "Active";
  if (optional) return "Optional";
  if (state === "complete") return "Complete";
  if (state === "needs_action") return "Needs action";
  if (state === "locked") return "Locked";
  return "Needs action";
}
