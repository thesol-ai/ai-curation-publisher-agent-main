import type { Source } from "@curator/core";
import { readProviderRuntimeConfig } from "@curator/providers";
import { runMockPollOperation } from "./mock-poll";
import type { Env } from "../types";

export type SchedulerRunMode = "scheduled" | "manual";

export type SchedulerRunOptions = {
  dryRun?: boolean;
  maxSources?: number;
  maxItems?: number;
  mode?: SchedulerRunMode;
  respectEnabled?: boolean;
  now?: () => Date;
};

export type SchedulerSettings = {
  schedulerEnabled: boolean;
  dryRun: boolean;
  maxSources: number;
  maxItems: number;
  realProvidersAllowed: boolean;
  publishingAllowed: boolean;
  providersMode: string;
  quotas: {
    maxAiItemsPerRun: number;
    maxProviderItemsPerRun: number;
    maxPublishItemsPerRun: number;
  };
};

export type ScheduledPollOperationResult = {
  ok: boolean;
  skipped: boolean;
  reason?: string;
  dryRun: boolean;
  schedulerEnabled: boolean;
  providersMode: string;
  realProvidersAllowed: boolean;
  publishingAllowed: boolean;
  maxSources: number;
  maxItems: number;
  totalSources: number;
  totalReturned: number;
  totalQueued: number;
  totalDuplicates: number;
  totalInvalid: number;
  totalErrors: number;
  warnings: string[];
  errors: string[];
  startedAt: string;
  finishedAt: string;
};

export function readSchedulerSettings(env: Env, overrides: SchedulerRunOptions = {}): SchedulerSettings {
  const envRecord = env as unknown as Record<string, string | undefined>;
  const providerConfig = readProviderRuntimeConfig(env);
  const maxProviderItemsPerRun = readPositiveInteger(envRecord.MAX_PROVIDER_ITEMS_PER_RUN, 5);

  return {
    schedulerEnabled: readBoolean(envRecord.SCHEDULER_ENABLED, false),
    dryRun: overrides.dryRun ?? readBoolean(envRecord.SCHEDULER_DRY_RUN, true),
    maxSources: clampPositiveInteger(overrides.maxSources, readPositiveInteger(envRecord.SCHEDULER_MAX_SOURCES_PER_RUN, 1)),
    maxItems: Math.min(
      clampPositiveInteger(overrides.maxItems, readPositiveInteger(envRecord.SCHEDULER_MAX_ITEMS_PER_RUN, 2)),
      maxProviderItemsPerRun
    ),
    realProvidersAllowed: readBoolean(envRecord.SCHEDULER_ALLOW_REAL_PROVIDERS, false),
    publishingAllowed: readBoolean(envRecord.SCHEDULER_ALLOW_PUBLISHING, false),
    providersMode: providerConfig.mode,
    quotas: {
      maxAiItemsPerRun: readPositiveInteger(envRecord.MAX_AI_ITEMS_PER_RUN, 0),
      maxProviderItemsPerRun,
      maxPublishItemsPerRun: readPositiveInteger(envRecord.MAX_PUBLISH_ITEMS_PER_RUN, 0)
    }
  };
}

export async function runScheduledPollOperation(env: Env, options: SchedulerRunOptions = {}): Promise<ScheduledPollOperationResult> {
  const now = options.now ?? (() => new Date());
  const startedAt = now().toISOString();
  const settings = readSchedulerSettings(env, options);
  const warnings = buildWarnings(settings);
  const errors: string[] = [];
  const respectEnabled = options.respectEnabled ?? true;

  if (respectEnabled && !settings.schedulerEnabled) {
    return {
      ok: true,
      skipped: true,
      reason: "scheduler_disabled",
      dryRun: settings.dryRun,
      schedulerEnabled: settings.schedulerEnabled,
      providersMode: settings.providersMode,
      realProvidersAllowed: settings.realProvidersAllowed,
      publishingAllowed: settings.publishingAllowed,
      maxSources: settings.maxSources,
      maxItems: settings.maxItems,
      totalSources: 0,
      totalReturned: 0,
      totalQueued: 0,
      totalDuplicates: 0,
      totalInvalid: 0,
      totalErrors: 0,
      warnings,
      errors,
      startedAt,
      finishedAt: now().toISOString()
    };
  }

  const sources = defaultSchedulerSources().slice(0, settings.maxSources);
  const pollResult = await runMockPollOperation({
    env,
    sources,
    options: {
      limit: settings.maxItems,
      backfillLimit: settings.maxItems,
      useIngestGate: false
    }
  });

  return {
    ok: true,
    skipped: false,
    dryRun: settings.dryRun,
    schedulerEnabled: settings.schedulerEnabled,
    providersMode: settings.providersMode,
    realProvidersAllowed: settings.realProvidersAllowed,
    publishingAllowed: settings.publishingAllowed,
    maxSources: settings.maxSources,
    maxItems: settings.maxItems,
    totalSources: pollResult.totalSources,
    totalReturned: pollResult.totalReturned,
    totalQueued: 0,
    totalDuplicates: pollResult.totalDuplicates,
    totalInvalid: pollResult.totalInvalid,
    totalErrors: pollResult.totalErrors,
    warnings,
    errors,
    startedAt,
    finishedAt: now().toISOString()
  };
}

function buildWarnings(settings: SchedulerSettings): string[] {
  const warnings: string[] = [];

  if (settings.providersMode !== "mock" && !settings.realProvidersAllowed) {
    warnings.push("Provider mode is not mock, but scheduler real provider access is disabled. Mock providers will be used.");
  }

  if (settings.realProvidersAllowed) {
    warnings.push("Real provider scheduler access is allowed by config, but Phase 21 still uses mock-safe polling only.");
  }

  if (settings.publishingAllowed) {
    warnings.push("Publishing is allowed by config, but Phase 21 scheduler does not trigger publishing.");
  }

  if (!settings.dryRun) {
    warnings.push("Scheduler dry-run is disabled, but Phase 21 still prevents publishing side effects.");
  }

  return warnings;
}

function defaultSchedulerSources(): Partial<Source>[] {
  return [
    {
      id: "scheduler_instagram_demo",
      platform: "instagram",
      sourceType: "profile",
      value: "demo_profile",
      providerPriority: ["mock_instagram"]
    },
    {
      id: "scheduler_x_demo",
      platform: "x",
      sourceType: "hashtag",
      value: "ai",
      providerPriority: ["mock_x"]
    },
    {
      id: "scheduler_web_demo",
      platform: "web",
      sourceType: "web_url",
      value: "https://source.local/demo",
      providerPriority: ["mock_web"]
    }
  ];
}

function readBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  return fallback;
}

function readPositiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim().length === 0) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }

  return parsed;
}

function clampPositiveInteger(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value) || value < 0) {
    return fallback;
  }

  return Math.floor(value);
}
