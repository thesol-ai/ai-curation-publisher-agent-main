import { describe, expect, it } from "vitest";
import { handleReady } from "./ready";
import { handleStatus } from "./status";
import type { Env } from "../types";

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    DB: {} as D1Database,
    ENVIRONMENT: "test",
    LOG_LEVEL: "debug",
    TELEGRAM_BOT_TOKEN: "configured-token",
    TELEGRAM_REVIEW_CHAT_ID: "review-chat",
    TELEGRAM_FINAL_CHAT_ID: "final-chat",
    TELEGRAM_REAL_REVIEW_ENABLED: "true",
    ...overrides
  };
}

async function json(response: Response): Promise<Record<string, unknown>> {
  return response.json() as Promise<Record<string, unknown>>;
}

describe("Telegram review dry-run status redaction", () => {
  it("status exposes booleans without token or chat values", async () => {
    const response = await handleStatus(new Request("https://worker.local/status"), makeEnv());
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(body.telegram).toMatchObject({
      reviewChatConfigured: true,
      finalChatConfigured: true,
      botTokenConfigured: true,
      realReviewEnabled: true
    });
    expect(JSON.stringify(body)).not.toContain("configured-token");
    expect(JSON.stringify(body)).not.toContain("review-chat");
    expect(JSON.stringify(body)).not.toContain("final-chat");
  });

  it("readiness exposes safe summary without token or chat values", async () => {
    const response = await handleReady(new Request("https://worker.local/ready"), makeEnv());
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(body.summary).toMatchObject({
      hasTelegramConfig: true,
      hasTelegramBotToken: true,
      telegramRealReviewEnabled: true
    });
    expect(JSON.stringify(body)).not.toContain("configured-token");
    expect(JSON.stringify(body)).not.toContain("review-chat");
    expect(JSON.stringify(body)).not.toContain("final-chat");
  });
});
