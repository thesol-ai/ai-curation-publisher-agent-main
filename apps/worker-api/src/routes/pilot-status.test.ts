import { describe, expect, it } from "vitest";
import { handleStatus } from "./status";
import type { Env } from "../types";

const hiddenRuntimeValue = "opaque-runtime-value";

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

describe("controlled pilot status summary", () => {
  it("does not mark manual-only mode ready by itself", async () => {
    const response = await handleStatus(new Request("https://worker.local/status"), makeEnv({ OPERATING_MODE: "manual_only" }));
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(body.pilot).toMatchObject({
      ready: false,
      modeAllowsPilot: true,
      setupSafe: true
    });
  });

  it("exposes safe pilot booleans without runtime values", async () => {
    const response = await handleStatus(new Request("https://worker.local/status"), makeEnv({
      INTERNAL_API_SECRET: "configured",
      PROVIDERS_MODE: "mixed",
      ENABLE_FIRECRAWL_PROVIDER: "true",
      FIRECRAWL_API_KEY: hiddenRuntimeValue,
      TELEGRAM_REAL_REVIEW_ENABLED: "true",
      TELEGRAM_BOT_TOKEN: hiddenRuntimeValue,
      WORDPRESS_REAL_DRY_RUN_ENABLED: "true",
      WORDPRESS_BASE_URL: "https://wordpress.local",
      WORDPRESS_USERNAME: "editor",
      WORDPRESS_APPLICATION_PASSWORD: hiddenRuntimeValue
    }));
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(body.pilot).toMatchObject({
      ready: true,
      modeAllowsPilot: true,
      setupSafe: true,
      firecrawlConfigured: true,
      telegramReviewConfigured: true,
      telegramRealReviewEnabled: true,
      wordpressConfigured: true,
      wordpressRealDryRunEnabled: true,
      schedulerEnabled: false,
      schedulerDryRun: true
    });
    expect(JSON.stringify(body)).not.toContain(hiddenRuntimeValue);
    expect(JSON.stringify(body)).not.toContain("wordpress.local");
    expect(JSON.stringify(body)).not.toContain("editor");
  });
});
