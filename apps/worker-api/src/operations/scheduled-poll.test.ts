import { describe, expect, it } from "vitest";
import { readSchedulerSettings, runScheduledPollOperation } from "./scheduled-poll";
import type { Env } from "../types";

function makeEnv(overrides: Record<string, string | undefined> = {}): Env {
  return {
    DB: {} as D1Database,
    ENVIRONMENT: "test",
    LOG_LEVEL: "debug",
    TELEGRAM_REVIEW_CHAT_ID: "review-chat",
    TELEGRAM_FINAL_CHAT_ID: "final-chat",
    ...overrides
  } as Env;
}

function fixedNow(): Date {
  return new Date("2026-01-01T00:00:00.000Z");
}

describe("scheduled poll safeguards", () => {
  it("is disabled and dry-run by default", () => {
    const settings = readSchedulerSettings(makeEnv());

    expect(settings).toMatchObject({
      schedulerEnabled: false,
      dryRun: true,
      maxSources: 1,
      maxItems: 2,
      realProvidersAllowed: false,
      publishingAllowed: false,
      providersMode: "mock",
      quotas: {
        maxAiItemsPerRun: 0,
        maxProviderItemsPerRun: 5,
        maxPublishItemsPerRun: 0
      }
    });
  });

  it("returns skipped result when scheduled execution is disabled", async () => {
    const result = await runScheduledPollOperation(makeEnv(), { now: fixedNow });

    expect(result).toMatchObject({
      ok: true,
      skipped: true,
      reason: "scheduler_disabled",
      dryRun: true,
      schedulerEnabled: false,
      realProvidersAllowed: false,
      publishingAllowed: false,
      totalSources: 0,
      totalReturned: 0,
      totalQueued: 0,
      totalErrors: 0,
      startedAt: "2026-01-01T00:00:00.000Z",
      finishedAt: "2026-01-01T00:00:00.000Z"
    });
  });

  it("manual dry-run can run mock-safe without enabling scheduler", async () => {
    const result = await runScheduledPollOperation(makeEnv(), {
      respectEnabled: false,
      dryRun: true,
      maxSources: 1,
      maxItems: 1,
      now: fixedNow
    });

    expect(result.skipped).toBe(false);
    expect(result.schedulerEnabled).toBe(false);
    expect(result.dryRun).toBe(true);
    expect(result.totalSources).toBe(1);
    expect(result.totalReturned).toBeGreaterThanOrEqual(0);
    expect(result.totalQueued).toBe(0);
    expect(result.maxSources).toBe(1);
    expect(result.maxItems).toBe(1);
  });

  it("respects max source and item limits", async () => {
    const result = await runScheduledPollOperation(makeEnv({
      SCHEDULER_ENABLED: "true",
      SCHEDULER_MAX_SOURCES_PER_RUN: "2",
      SCHEDULER_MAX_ITEMS_PER_RUN: "1",
      MAX_PROVIDER_ITEMS_PER_RUN: "1"
    }), { now: fixedNow });

    expect(result.skipped).toBe(false);
    expect(result.schedulerEnabled).toBe(true);
    expect(result.maxSources).toBe(2);
    expect(result.maxItems).toBe(1);
    expect(result.totalSources).toBe(2);
  });

  it("does not use real providers unless explicitly allowed and still warns when allowed", async () => {
    const result = await runScheduledPollOperation(makeEnv({
      SCHEDULER_ENABLED: "true",
      PROVIDERS_MODE: "mixed",
      SCHEDULER_ALLOW_REAL_PROVIDERS: "true"
    }), { now: fixedNow });

    expect(result.providersMode).toBe("mixed");
    expect(result.realProvidersAllowed).toBe(true);
    expect(result.warnings).toContain("Real provider scheduler access is allowed by config, but Phase 21 still uses mock-safe polling only.");
  });

  it("does not publish even if publishing is explicitly allowed", async () => {
    const result = await runScheduledPollOperation(makeEnv({
      SCHEDULER_ENABLED: "true",
      SCHEDULER_DRY_RUN: "false",
      SCHEDULER_ALLOW_PUBLISHING: "true"
    }), { now: fixedNow });

    expect(result.dryRun).toBe(false);
    expect(result.publishingAllowed).toBe(true);
    expect(result.warnings).toContain("Publishing is allowed by config, but Phase 21 scheduler does not trigger publishing.");
    expect(result.totalQueued).toBeGreaterThanOrEqual(0);
  });
});
