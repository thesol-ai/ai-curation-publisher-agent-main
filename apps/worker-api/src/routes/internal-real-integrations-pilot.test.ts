import { describe, expect, it } from "vitest";
import { MockProviderHttpClient } from "@curator/providers";
import { MockTelegramClient } from "@curator/telegram";
import { MockWordPressClient } from "@curator/wordpress";
import { handleInternalRealIntegrationsPilot } from "./internal-real-integrations-pilot";
import type { Env } from "../types";

const hiddenRuntimeValue = "opaque-runtime-value";
const hiddenInternalValue = "opaque-internal-value";

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

function configuredPilotEnv(overrides: Record<string, string | undefined> = {}): Env {
  return makeEnv({
    PROVIDERS_MODE: "mixed",
    ENABLE_FIRECRAWL_PROVIDER: "true",
    FIRECRAWL_API_KEY: hiddenRuntimeValue,
    TELEGRAM_REAL_REVIEW_ENABLED: "true",
    TELEGRAM_BOT_TOKEN: hiddenRuntimeValue,
    WORDPRESS_REAL_DRY_RUN_ENABLED: "true",
    WORDPRESS_BASE_URL: "https://wordpress.local",
    WORDPRESS_USERNAME: "editor",
    WORDPRESS_APPLICATION_PASSWORD: hiddenRuntimeValue,
    ...overrides
  });
}

function mockFirecrawlClient(): MockProviderHttpClient {
  return new MockProviderHttpClient([
    {
      method: "POST",
      url: "https://api.firecrawl.dev/v1/scrape",
      response: {
        data: {
          url: "https://example.com/article",
          title: "Article title",
          markdown: "Article body"
        }
      }
    }
  ]);
}

async function json(response: Response): Promise<Record<string, unknown>> {
  return response.json() as Promise<Record<string, unknown>>;
}

describe("handleInternalRealIntegrationsPilot", () => {
  it("rejects invalid methods", async () => {
    const response = await handleInternalRealIntegrationsPilot(
      new Request("https://worker.local/internal/pilot/real-integrations", { method: "GET" }),
      makeEnv()
    );
    const body = await json(response);

    expect(response.status).toBe(405);
    expect(body.error).toBe("method_not_allowed");
  });

  it("requires internal secret when configured", async () => {
    const response = await handleInternalRealIntegrationsPilot(
      new Request("https://worker.local/internal/pilot/real-integrations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({})
      }),
      makeEnv({ INTERNAL_API_SECRET: hiddenInternalValue })
    );
    const body = await json(response);

    expect(response.status).toBe(401);
    expect(body.error).toBe("internal_auth_required");
    expect(JSON.stringify(body)).not.toContain(hiddenInternalValue);
  });

  it("returns readiness summary only for empty body", async () => {
    const httpClient = mockFirecrawlClient();
    const telegramClient = new MockTelegramClient();
    const wordpressClient = new MockWordPressClient();

    const response = await handleInternalRealIntegrationsPilot(
      new Request("https://worker.local/internal/pilot/real-integrations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({})
      }),
      makeEnv(),
      { httpClient, telegramClient, wordpressClient }
    );
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      mode: "pilot",
      inspectOnly: true,
      firecrawl: { requested: false, skipped: true },
      telegramReview: { requested: false, skipped: true },
      wordpressDraft: { requested: false, skipped: true }
    });
    expect(httpClient.requests).toHaveLength(0);
    expect(telegramClient.sentReviewMessages).toHaveLength(0);
    expect(wordpressClient.createdPosts).toHaveLength(0);
  });

  it("rejects Firecrawl run without a valid URL", async () => {
    const response = await handleInternalRealIntegrationsPilot(
      new Request("https://worker.local/internal/pilot/real-integrations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ runFirecrawl: true })
      }),
      makeEnv()
    );
    const body = await json(response);

    expect(response.status).toBe(400);
    expect(body.error).toBe("missing_firecrawl_url");
  });

  it("runs requested steps with injected mocks", async () => {
    const httpClient = mockFirecrawlClient();
    const telegramClient = new MockTelegramClient();
    const wordpressClient = new MockWordPressClient();

    const response = await handleInternalRealIntegrationsPilot(
      new Request("https://worker.local/internal/pilot/real-integrations", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-internal-api-secret": hiddenInternalValue
        },
        body: JSON.stringify({
          runFirecrawl: true,
          runTelegramReview: true,
          runWordPressDraft: true,
          firecrawlUrl: "https://example.com/article",
          telegramText: "Review content",
          wordpressTitle: "Draft title",
          wordpressContent: "Draft content",
          sourceUrl: "https://example.com/source"
        })
      }),
      configuredPilotEnv({ INTERNAL_API_SECRET: hiddenInternalValue }),
      { httpClient, telegramClient, wordpressClient }
    );
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(body.firecrawl).toMatchObject({ requested: true, skipped: false, ok: true });
    expect(body.telegramReview).toMatchObject({ requested: true, skipped: false, ok: true });
    expect(body.wordpressDraft).toMatchObject({ requested: true, skipped: false, ok: true });
    expect(httpClient.requests).toHaveLength(1);
    expect(telegramClient.sentReviewMessages).toHaveLength(1);
    expect(telegramClient.publishedFinalMessages).toHaveLength(0);
    expect(wordpressClient.createdPosts).toHaveLength(1);
    expect(wordpressClient.createdPosts[0]?.status).toBe("draft");
    expect(JSON.stringify(body)).not.toContain(hiddenInternalValue);
    expect(JSON.stringify(body)).not.toContain(hiddenRuntimeValue);
    expect(JSON.stringify(body)).not.toContain("editor");
    expect(JSON.stringify(body)).not.toContain("application-password");
    expect(JSON.stringify(body)).not.toContain("wordpress-password");
  });
});
