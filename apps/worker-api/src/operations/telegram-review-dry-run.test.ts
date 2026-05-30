import { describe, expect, it } from "vitest";
import { MockTelegramClient, TelegramClientError, type EditReviewMessageReplyMarkupInput, type TelegramClient, type TelegramClientMessage } from "@curator/telegram";
import { runTelegramReviewDryRun } from "./telegram-review-dry-run";
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

class FailingTelegramClient implements TelegramClient {
  async sendReviewMessage(): Promise<never> {
    throw new TelegramClientError({
      category: "telegram_api_error",
      message: "Telegram Bot API returned an error."
    });
  }

  async editReviewMessage(): Promise<never> {
    throw new Error("not used");
  }

  async publishFinalMessage(): Promise<never> {
    throw new Error("not used");
  }

  async answerCallbackQuery(): Promise<void> {}
  async editReviewMessageReplyMarkup(input: EditReviewMessageReplyMarkupInput): Promise<TelegramClientMessage> {
    return {
      chatId: input.chatId,
      messageId: input.messageId,
      text: "",
      replyMarkup: input.replyMarkup
    };
  }

}

describe("runTelegramReviewDryRun", () => {
  it("uses mock mode by default without real token", async () => {
    const client = new MockTelegramClient();

    const result = await runTelegramReviewDryRun({
      env: makeEnv({}),
      input: {
        text: "Review dry-run text",
        sourceUrl: "https://example.com/post"
      },
      client
    });

    expect(result).toMatchObject({
      ok: true,
      mode: "mock",
      reviewMessageSent: true,
      chatConfigured: true,
      tokenConfigured: false,
      realReviewEnabled: false,
      telegramMessageId: "mock_telegram_review_1"
    });
    expect(client.sentReviewMessages).toHaveLength(1);
    expect(client.sentReviewMessages[0]?.text).toContain("Review dry-run text");
    expect(client.publishedFinalMessages).toEqual([]);
  });

  it("returns missing config when real review is enabled without token", async () => {
    const result = await runTelegramReviewDryRun({
      env: makeEnv({
        TELEGRAM_REAL_REVIEW_ENABLED: "true"}),
      input: { text: "Review dry-run text" },
      client: new MockTelegramClient()
    });

    expect(result).toMatchObject({
      ok: false,
      mode: "real",
      reviewMessageSent: false,
      chatConfigured: true,
      tokenConfigured: false,
      realReviewEnabled: true,
      error: "missing_config"
    });
  });

  it("returns missing config when real review is enabled without review chat", async () => {
    const result = await runTelegramReviewDryRun({
      env: makeEnv({
        TELEGRAM_REAL_REVIEW_ENABLED: "true",
        TELEGRAM_BOT_TOKEN: "configured-token",
        TELEGRAM_REVIEW_CHAT_ID: ""
      }),
      input: { text: "Review dry-run text" },
      client: new MockTelegramClient()
    });

    expect(result).toMatchObject({
      ok: false,
      mode: "real",
      reviewMessageSent: false,
      chatConfigured: false,
      tokenConfigured: true,
      realReviewEnabled: true,
      error: "missing_config"
    });
  });

  it("uses injected Telegram client when real review is enabled and configured", async () => {
    const client = new MockTelegramClient();

    const result = await runTelegramReviewDryRun({
      env: makeEnv({
        TELEGRAM_REAL_REVIEW_ENABLED: "true",
        TELEGRAM_BOT_TOKEN: "configured-token",
        TELEGRAM_REVIEW_CHAT_ID: "review-chat"
      }),
      input: {
        text: "Real review dry-run text",
        sourceUrl: "https://example.com/post"
      },
      client
    });

    expect(result).toMatchObject({
      ok: true,
      mode: "real",
      reviewMessageSent: true,
      chatConfigured: true,
      tokenConfigured: true,
      realReviewEnabled: true,
      telegramMessageId: "mock_telegram_review_1"
    });
    expect(client.sentReviewMessages).toHaveLength(1);
    expect(client.sentReviewMessages[0]?.chatId).toBe("review-chat");
    expect(client.publishedFinalMessages).toEqual([]);
  });

  it("returns typed Telegram client failures without exposing token", async () => {
    const result = await runTelegramReviewDryRun({
      env: makeEnv({
        TELEGRAM_REAL_REVIEW_ENABLED: "true",
        TELEGRAM_BOT_TOKEN: "configured-token",
        TELEGRAM_REVIEW_CHAT_ID: "review-chat"
      }),
      input: { text: "Review dry-run text" },
      client: new FailingTelegramClient()
    });

    expect(result).toMatchObject({
      ok: false,
      mode: "real",
      reviewMessageSent: false,
      error: "telegram_api_error",
      message: "Telegram Bot API returned an error."
    });
    expect(JSON.stringify(result)).not.toContain("configured-token");
  });
});
