import { describe, expect, it } from "vitest";
import { handleReady } from "./ready";
import { handleStatus } from "./status";
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

async function json(response: Response): Promise<Record<string, unknown>> {
  return response.json() as Promise<Record<string, unknown>>;
}

describe("scheduler status summary", () => {
  it("status exposes safe scheduler, quota, and publishing summaries", async () => {
    const response = await handleStatus(new Request("https://worker.local/status"), makeEnv({
      SCHEDULER_ENABLED: "true",
      SCHEDULER_DRY_RUN: "true",
      SCHEDULER_MAX_SOURCES_PER_RUN: "2",
      SCHEDULER_MAX_ITEMS_PER_RUN: "3",
      MAX_AI_ITEMS_PER_RUN: "1",
      MAX_PROVIDER_ITEMS_PER_RUN: "3",
      MAX_PUBLISH_ITEMS_PER_RUN: "0"
    }));
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(body.scheduler).toMatchObject({
      enabled: true,
      dryRun: true,
      realProvidersAllowed: false,
      publishingAllowed: false,
      maxSourcesPerRun: 2,
      maxItemsPerRun: 3
    });
    expect(body.quotas).toMatchObject({
      maxAiItemsPerRun: 1,
      maxProviderItemsPerRun: 3,
      maxPublishItemsPerRun: 0
    });
    expect(body.modules).toMatchObject({
      publishing: {
        available: true,
        publicPublishingEnabled: false,
        schedulerPublishingAllowed: false
      }
    });
  });

  it("readiness exposes risky scheduler publishing as an error without secrets", async () => {
    const response = await handleReady(new Request("https://worker.local/ready"), makeEnv({
      INTERNAL_API_SECRET: "configured-secret",
      SCHEDULER_ENABLED: "true",
      SCHEDULER_ALLOW_REAL_PROVIDERS: "true",
      SCHEDULER_ALLOW_PUBLISHING: "true"
    }));
    const body = await json(response);

    expect(response.status).toBe(503);
    expect(body.summary).toMatchObject({
      scheduler: {
        enabled: true,
        dryRun: true,
        realProvidersAllowed: true,
        publishingAllowed: true,
        maxSourcesPerRun: 1,
        maxItemsPerRun: 2
      },
      quotas: {
        maxAiItemsPerRun: 0,
        maxProviderItemsPerRun: 5,
        maxPublishItemsPerRun: 0
      }
    });
    expect(body.errors).toContain("Scheduler publishing is configured on. This phase does not support scheduler publishing.");
    expect(JSON.stringify(body)).not.toContain("configured-secret");
  });
});
