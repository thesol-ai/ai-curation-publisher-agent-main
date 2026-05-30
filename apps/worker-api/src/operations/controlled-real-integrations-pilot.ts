import type { ProviderHttpClient } from "@curator/providers";
import type { TelegramClient } from "@curator/telegram";
import type { WordPressClient } from "@curator/wordpress";
import { validateRuntimeConfig, type ConfigValidationResult } from "../config";
import { runFirecrawlSandboxFetch, type FirecrawlSandboxFetchResult } from "./firecrawl-sandbox";
import { runTelegramReviewDryRun, type TelegramReviewDryRunResult } from "./telegram-review-dry-run";
import { runWordPressDryRun, type WordPressDryRunResult } from "./wordpress-dry-run";
import type { Env } from "../types";

export type ControlledRealIntegrationsPilotInput = {
  runFirecrawl?: boolean;
  runTelegramReview?: boolean;
  runWordPressDraft?: boolean;
  firecrawlUrl?: string;
  telegramText?: string;
  wordpressTitle?: string;
  wordpressContent?: string;
  sourceUrl?: string;
};

export type PilotSkippedStep = {
  step: "firecrawl" | "telegramReview" | "wordpressDraft";
  reason: string;
};

export type PilotStepResult<T> = {
  requested: boolean;
  skipped: boolean;
  configured: boolean;
  enabled: boolean;
  ok?: boolean;
  result?: T;
  error?: string;
  message?: string;
};

export type ControlledRealIntegrationsPilotResult = {
  ok: boolean;
  mode: "pilot";
  inspectOnly: true;
  readiness: ConfigValidationResult;
  safety: {
    firecrawlEnabled: boolean;
    firecrawlConfigured: boolean;
    telegramRealReviewEnabled: boolean;
    telegramConfigured: boolean;
    wordpressRealDryRunEnabled: boolean;
    wordpressConfigured: boolean;
    schedulerEnabled: boolean;
    schedulerDryRun: boolean;
    schedulerPublishingAllowed: boolean;
  };
  firecrawl: PilotStepResult<FirecrawlSandboxFetchResult>;
  telegramReview: PilotStepResult<TelegramReviewDryRunResult>;
  wordpressDraft: PilotStepResult<WordPressDryRunResult>;
  skipped: PilotSkippedStep[];
  warnings: string[];
  errors: string[];
  startedAt: string;
  finishedAt: string;
};

export type ControlledRealIntegrationsPilotOptions = {
  env: Env;
  input?: ControlledRealIntegrationsPilotInput;
  httpClient?: ProviderHttpClient;
  telegramClient?: TelegramClient;
  wordpressClient?: WordPressClient;
  now?: () => Date;
};

export async function runControlledRealIntegrationsPilot(
  options: ControlledRealIntegrationsPilotOptions
): Promise<ControlledRealIntegrationsPilotResult> {
  const input = options.input ?? {};
  const now = options.now ?? (() => new Date());
  const startedAt = now().toISOString();
  const readiness = validateRuntimeConfig(options.env);
  const safety = summarizePilotSafety(readiness);
  const skipped: PilotSkippedStep[] = [];
  const warnings = [...readiness.warnings];
  const errors = [...readiness.errors];

  const firecrawl = await maybeRunFirecrawl({ options, input, safety, skipped, warnings, errors });
  const telegramReview = await maybeRunTelegramReview({ options, input, safety, skipped, warnings, errors });
  const wordpressDraft = await maybeRunWordPressDraft({ options, input, safety, skipped, warnings, errors });

  return {
    ok: errors.length === 0 && [firecrawl, telegramReview, wordpressDraft].every((step) => step.ok !== false),
    mode: "pilot",
    inspectOnly: true,
    readiness,
    safety,
    firecrawl,
    telegramReview,
    wordpressDraft,
    skipped,
    warnings,
    errors,
    startedAt,
    finishedAt: now().toISOString()
  };
}

export function summarizePilotSafety(readiness: ConfigValidationResult): ControlledRealIntegrationsPilotResult["safety"] {
  const summary = readiness.summary;

  return {
    firecrawlEnabled: summary.providersMode !== "mock" && summary.hasProviderCredentials.firecrawl,
    firecrawlConfigured: summary.hasProviderCredentials.firecrawl,
    telegramRealReviewEnabled: summary.telegramRealReviewEnabled,
    telegramConfigured: summary.hasTelegramConfig && summary.hasTelegramBotToken,
    wordpressRealDryRunEnabled: summary.wordpressRealDryRunEnabled,
    wordpressConfigured: summary.hasWordPressConfig,
    schedulerEnabled: summary.scheduler.enabled,
    schedulerDryRun: summary.scheduler.dryRun,
    schedulerPublishingAllowed: summary.scheduler.publishingAllowed
  };
}

function skippedStep<T>(step: PilotSkippedStep["step"], reason: string, configured: boolean, enabled: boolean, skipped: PilotSkippedStep[]): PilotStepResult<T> {
  skipped.push({ step, reason });

  return {
    requested: false,
    skipped: true,
    configured,
    enabled,
    message: reason
  };
}

async function maybeRunFirecrawl(input: {
  options: ControlledRealIntegrationsPilotOptions;
  input: ControlledRealIntegrationsPilotInput;
  safety: ControlledRealIntegrationsPilotResult["safety"];
  skipped: PilotSkippedStep[];
  warnings: string[];
  errors: string[];
}): Promise<PilotStepResult<FirecrawlSandboxFetchResult>> {
  if (input.input.runFirecrawl !== true) {
    return skippedStep("firecrawl", "firecrawl_not_requested", input.safety.firecrawlConfigured, input.safety.firecrawlEnabled, input.skipped);
  }

  if (typeof input.input.firecrawlUrl !== "string" || input.input.firecrawlUrl.trim().length === 0) {
    input.errors.push("Firecrawl pilot requested without firecrawlUrl.");
    return {
      requested: true,
      skipped: true,
      configured: input.safety.firecrawlConfigured,
      enabled: input.safety.firecrawlEnabled,
      ok: false,
      error: "missing_firecrawl_url",
      message: "Firecrawl pilot requires firecrawlUrl."
    };
  }

  const result = await runFirecrawlSandboxFetch({
    env: input.options.env,
    input: { url: input.input.firecrawlUrl, limit: 1 },
    ...(input.options.httpClient === undefined ? {} : { httpClient: input.options.httpClient })
  });

  if (!result.ok) {
    input.warnings.push("Firecrawl pilot step did not complete successfully.");
  }

  return {
    requested: true,
    skipped: false,
    configured: result.configured,
    enabled: result.enabled,
    ok: result.ok,
    result,
    ...(result.error === undefined ? {} : { error: result.error }),
    ...(result.message === undefined ? {} : { message: result.message })
  };
}

async function maybeRunTelegramReview(input: {
  options: ControlledRealIntegrationsPilotOptions;
  input: ControlledRealIntegrationsPilotInput;
  safety: ControlledRealIntegrationsPilotResult["safety"];
  skipped: PilotSkippedStep[];
  warnings: string[];
  errors: string[];
}): Promise<PilotStepResult<TelegramReviewDryRunResult>> {
  if (input.input.runTelegramReview !== true) {
    return skippedStep("telegramReview", "telegram_review_not_requested", input.safety.telegramConfigured, input.safety.telegramRealReviewEnabled, input.skipped);
  }

  const text = typeof input.input.telegramText === "string" && input.input.telegramText.trim().length > 0
    ? input.input.telegramText
    : "Controlled pilot Telegram review dry-run";

  const result = await runTelegramReviewDryRun({
    env: input.options.env,
    input: {
      text,
      ...(input.input.sourceUrl === undefined ? {} : { sourceUrl: input.input.sourceUrl })
    },
    ...(input.options.telegramClient === undefined ? {} : { client: input.options.telegramClient })
  });

  if (!result.ok) {
    input.warnings.push("Telegram review pilot step did not complete successfully.");
  }

  return {
    requested: true,
    skipped: false,
    configured: result.chatConfigured && result.tokenConfigured,
    enabled: result.realReviewEnabled,
    ok: result.ok,
    result,
    ...(result.error === undefined ? {} : { error: result.error }),
    ...(result.message === undefined ? {} : { message: result.message })
  };
}

async function maybeRunWordPressDraft(input: {
  options: ControlledRealIntegrationsPilotOptions;
  input: ControlledRealIntegrationsPilotInput;
  safety: ControlledRealIntegrationsPilotResult["safety"];
  skipped: PilotSkippedStep[];
  warnings: string[];
  errors: string[];
}): Promise<PilotStepResult<WordPressDryRunResult>> {
  if (input.input.runWordPressDraft !== true) {
    return skippedStep("wordpressDraft", "wordpress_draft_not_requested", input.safety.wordpressConfigured, input.safety.wordpressRealDryRunEnabled, input.skipped);
  }

  const title = typeof input.input.wordpressTitle === "string" && input.input.wordpressTitle.trim().length > 0
    ? input.input.wordpressTitle
    : "Controlled pilot WordPress draft";
  const content = typeof input.input.wordpressContent === "string" && input.input.wordpressContent.trim().length > 0
    ? input.input.wordpressContent
    : "Controlled pilot WordPress draft content.";

  const result = await runWordPressDryRun({
    env: input.options.env,
    input: {
      title,
      content,
      ...(input.input.sourceUrl === undefined ? {} : { sourceUrl: input.input.sourceUrl })
    },
    ...(input.options.wordpressClient === undefined ? {} : { client: input.options.wordpressClient })
  });

  if (!result.ok) {
    input.warnings.push("WordPress draft pilot step did not complete successfully.");
  }

  return {
    requested: true,
    skipped: false,
    configured: result.wordpressConfigured && result.credentialsConfigured,
    enabled: result.realDryRunEnabled,
    ok: result.ok,
    result,
    ...(result.error === undefined ? {} : { error: result.error }),
    ...(result.message === undefined ? {} : { message: result.message })
  };
}
