import { describe, expect, it } from "vitest";
import { MockProviderHttpClient } from "@curator/providers";
import { MockTelegramClient } from "@curator/telegram";
import { MockWordPressClient, WordPressClientError, type WordPressClient, type WordPressPostInput, type WordPressPostResult } from "@curator/wordpress";
import { runControlledRealIntegrationsPilot } from "./controlled-real-integrations-pilot";
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

function configuredPilotEnv(overrides: Record<string, string | undefined> = {}): Env {
  return makeEnv({
    PROVIDERS_MODE: "mixed",
    ENABLE_FIRECRAWL_PROVIDER: "true",
    FIRECRAWL_API_KEY: "configured",
    TELEGRAM_REAL_REVIEW_ENABLED: "true",
    TELEGRAM_BOT_TOKEN: "configured",
    WORDPRESS_REAL_DRY_RUN_ENABLED: "true",
    WORDPRESS_BASE_URL: "https://wordpress.local",
    WORDPRESS_USERNAME: "editor",
    WORDPRESS_APPLICATION_PASSWORD: "configured",
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

class FailingWordPressClient implements WordPressClient {
  async createPost(_input: WordPressPostInput): Promise<WordPressPostResult> {
    throw new WordPressClientError({
      category: "wordpress_api_error",
      message: "WordPress REST API returned an error."
    });
  }
}

describe("runControlledRealIntegrationsPilot", () => {
  it("returns readiness summary only when no integrations are requested", async () => {
    const httpClient = mockFirecrawlClient();
    const telegramClient = new MockTelegramClient();
    const wordpressClient = new MockWordPressClient();

    const result = await runControlledRealIntegrationsPilot({
      env: makeEnv(),
      input: {},
      httpClient,
      telegramClient,
      wordpressClient,
      now: () => new Date("2026-01-01T00:00:00.000Z")
    });

    expect(result).toMatchObject({
      ok: true,
      mode: "pilot",
      inspectOnly: true,
      firecrawl: { requested: false, skipped: true, message: "firecrawl_not_requested" },
      telegramReview: { requested: false, skipped: true, message: "telegram_review_not_requested" },
      wordpressDraft: { requested: false, skipped: true, message: "wordpress_draft_not_requested" },
      startedAt: "2026-01-01T00:00:00.000Z",
      finishedAt: "2026-01-01T00:00:00.000Z"
    });
    expect(result.skipped).toHaveLength(3);
    expect(httpClient.requests).toHaveLength(0);
    expect(telegramClient.sentReviewMessages).toHaveLength(0);
    expect(wordpressClient.createdPosts).toHaveLength(0);
  });

  it("runs only the explicitly requested Firecrawl step", async () => {
    const httpClient = mockFirecrawlClient();
    const telegramClient = new MockTelegramClient();
    const wordpressClient = new MockWordPressClient();

    const result = await runControlledRealIntegrationsPilot({
      env: configuredPilotEnv(),
      input: {
        runFirecrawl: true,
        firecrawlUrl: "https://example.com/article"
      },
      httpClient,
      telegramClient,
      wordpressClient
    });

    expect(result.firecrawl).toMatchObject({ requested: true, skipped: false, ok: true });
    expect(result.telegramReview.requested).toBe(false);
    expect(result.wordpressDraft.requested).toBe(false);
    expect(httpClient.requests).toHaveLength(1);
    expect(telegramClient.sentReviewMessages).toHaveLength(0);
    expect(wordpressClient.createdPosts).toHaveLength(0);
  });

  it("runs explicitly requested Telegram and WordPress steps with mock clients", async () => {
    const telegramClient = new MockTelegramClient();
    const wordpressClient = new MockWordPressClient();

    const result = await runControlledRealIntegrationsPilot({
      env: configuredPilotEnv(),
      input: {
        runTelegramReview: true,
        runWordPressDraft: true,
        telegramText: "Review content",
        wordpressTitle: "Draft title",
        wordpressContent: "Draft content",
        sourceUrl: "https://example.com/source"
      },
      telegramClient,
      wordpressClient
    });

    expect(result.telegramReview).toMatchObject({ requested: true, skipped: false, ok: true });
    expect(result.wordpressDraft).toMatchObject({ requested: true, skipped: false, ok: true });
    expect(result.firecrawl.requested).toBe(false);
    expect(telegramClient.sentReviewMessages).toHaveLength(1);
    expect(telegramClient.publishedFinalMessages).toHaveLength(0);
    expect(wordpressClient.createdPosts).toHaveLength(1);
    expect(wordpressClient.createdPosts[0]?.status).toBe("draft");
  });

  it("reports one failed step without hiding other step statuses", async () => {
    const telegramClient = new MockTelegramClient();

    const result = await runControlledRealIntegrationsPilot({
      env: configuredPilotEnv(),
      input: {
        runTelegramReview: true,
        runWordPressDraft: true,
        telegramText: "Review content",
        wordpressTitle: "Draft title",
        wordpressContent: "Draft content"
      },
      telegramClient,
      wordpressClient: new FailingWordPressClient()
    });

    expect(result.ok).toBe(false);
    expect(result.telegramReview).toMatchObject({ requested: true, ok: true });
    expect(result.wordpressDraft).toMatchObject({ requested: true, ok: false, error: "wordpress_api_error" });
    expect(result.warnings).toContain("WordPress draft pilot step did not complete successfully.");
  });

  it("does not expose configured runtime values in pilot result", async () => {
    const result = await runControlledRealIntegrationsPilot({
      env: configuredPilotEnv({ INTERNAL_API_SECRET: "configured-internal" }),
      input: {},
      now: () => new Date("2026-01-01T00:00:00.000Z")
    });

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("configured-internal");
    expect(serialized).not.toContain("wordpress.local");
    expect(serialized).not.toContain("editor");
  });
});
