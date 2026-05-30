import { describe, expect, it } from "vitest";
import { MockTelegramClient } from "@curator/telegram";
import { handleInternalTelegramReviewDryRun } from "./internal-telegram-review-dry-run";
import type { Env } from "../types";

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    DB: {} as D1Database,
    ENVIRONMENT: "test",
    LOG_LEVEL: "debug",
    TELEGRAM_REVIEW_CHAT_ID: "review-chat",
    TELEGRAM_FINAL_CHAT_ID: "final-chat",
    ...overrides
  };
}

async function json(response: Response): Promise<Record<string, unknown>> {
  return response.json() as Promise<Record<string, unknown>>;
}

describe("handleInternalTelegramReviewDryRun", () => {
  it("rejects invalid methods", async () => {
    const response = await handleInternalTelegramReviewDryRun(
      new Request("https://worker.local/internal/telegram/review-dry-run", { method: "GET" }),
      makeEnv()
    );
    const body = await json(response);

    expect(response.status).toBe(405);
    expect(body.error).toBe("method_not_allowed");
  });

  it("requires internal secret when configured", async () => {
    const response = await handleInternalTelegramReviewDryRun(
      new Request("https://worker.local/internal/telegram/review-dry-run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "Review dry-run text" })
      }),
      makeEnv({ INTERNAL_API_SECRET: "configured-secret" })
    );
    const body = await json(response);

    expect(response.status).toBe(401);
    expect(body.error).toBe("internal_auth_required");
    expect(JSON.stringify(body)).not.toContain("configured-secret");
  });

  it("rejects missing text", async () => {
    const response = await handleInternalTelegramReviewDryRun(
      new Request("https://worker.local/internal/telegram/review-dry-run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sourceUrl: "https://example.com/post" })
      }),
      makeEnv()
    );
    const body = await json(response);

    expect(response.status).toBe(400);
    expect(body.error).toBe("missing_text");
  });

  it("rejects invalid sourceUrl", async () => {
    const response = await handleInternalTelegramReviewDryRun(
      new Request("https://worker.local/internal/telegram/review-dry-run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "Review dry-run text", sourceUrl: "not-a-url" })
      }),
      makeEnv()
    );
    const body = await json(response);

    expect(response.status).toBe(400);
    expect(body.error).toBe("invalid_source_url");
  });

  it("succeeds in mock mode without a real token", async () => {
    const client = new MockTelegramClient();
    const response = await handleInternalTelegramReviewDryRun(
      new Request("https://worker.local/internal/telegram/review-dry-run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "Review dry-run text", sourceUrl: "https://example.com/post" })
      }),
      makeEnv({}),
      undefined,
      client
    );
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      mode: "mock",
      reviewMessageSent: true,
      chatConfigured: true,
      tokenConfigured: false,
      realReviewEnabled: false,
      telegramMessageId: "mock_telegram_review_1"
    });
    expect(client.sentReviewMessages).toHaveLength(1);
    expect(client.publishedFinalMessages).toEqual([]);
  });

  it("returns missing config when real review mode is enabled without required config", async () => {
    const response = await handleInternalTelegramReviewDryRun(
      new Request("https://worker.local/internal/telegram/review-dry-run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "Review dry-run text" })
      }),
      makeEnv({
        TELEGRAM_REAL_REVIEW_ENABLED: "true",
        
        TELEGRAM_REVIEW_CHAT_ID: "review-chat"
      }),
      undefined,
      new MockTelegramClient()
    );
    const body = await json(response);

    expect(response.status).toBe(409);
    expect(body).toMatchObject({
      ok: false,
      mode: "real",
      reviewMessageSent: false,
      chatConfigured: true,
      tokenConfigured: false,
      realReviewEnabled: true,
      error: "missing_config"
    });
  });

  it("succeeds in real mode with injected mock Telegram client", async () => {
    const client = new MockTelegramClient();
    const response = await handleInternalTelegramReviewDryRun(
      new Request("https://worker.local/internal/telegram/review-dry-run", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-internal-api-secret": "configured-secret"
        },
        body: JSON.stringify({ text: "Review dry-run text", sourceUrl: "https://example.com/post" })
      }),
      makeEnv({
        INTERNAL_API_SECRET: "configured-secret",
        TELEGRAM_REAL_REVIEW_ENABLED: "true",
        TELEGRAM_BOT_TOKEN: "configured-token",
        TELEGRAM_REVIEW_CHAT_ID: "review-chat"
      }),
      undefined,
      client
    );
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      mode: "real",
      reviewMessageSent: true,
      chatConfigured: true,
      tokenConfigured: true,
      realReviewEnabled: true,
      telegramMessageId: "mock_telegram_review_1"
    });
    expect(JSON.stringify(body)).not.toContain("configured-token");
    expect(JSON.stringify(body)).not.toContain("review-chat");
    expect(client.sentReviewMessages).toHaveLength(1);
    expect(client.publishedFinalMessages).toEqual([]);
  });
});
