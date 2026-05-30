import { describe, expect, it, vi } from "vitest";
import { buildReviewInlineKeyboard } from "./index";
import { RealTelegramClient, TelegramClientError } from "./real-telegram-client";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function successMessage(messageId = 42, chatId = "final-chat", text = "Final text"): unknown {
  return {
    ok: true,
    result: {
      message_id: messageId,
      chat: { id: chatId },
      text
    }
  };
}

function requestBody(fetchImpl: typeof fetch): Record<string, unknown> {
  const [, init] = vi.mocked(fetchImpl).mock.calls[0] ?? [];
  return JSON.parse(String(init?.body)) as Record<string, unknown>;
}

function requestUrl(fetchImpl: typeof fetch): string {
  const [url] = vi.mocked(fetchImpl).mock.calls[0] ?? [];
  return String(url);
}

describe("RealTelegramClient", () => {
  it("builds sendMessage request using an injected fetch implementation", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      ok: true,
      result: {
        message_id: 42,
        chat: { id: "review-chat" },
        text: "Review text"
      }
    })) as unknown as typeof fetch;
    const client = new RealTelegramClient({
      botToken: "configured-token",
      fetchImpl,
      apiBaseUrl: "https://telegram.local"
    });

    const message = await client.sendReviewMessage({
      chatId: "review-chat",
      text: "Review text",
      replyMarkup: buildReviewInlineKeyboard("item_1")
    });

    expect(message).toMatchObject({
      chatId: "review-chat",
      messageId: "42",
      text: "Review text"
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(requestUrl(fetchImpl)).toBe("https://telegram.local/botconfigured-token/sendMessage");
    expect(vi.mocked(fetchImpl).mock.calls[0]?.[1]).toMatchObject({ method: "POST" });
    expect(requestBody(fetchImpl)).toMatchObject({
      chat_id: "review-chat",
      text: "Review text",
      disable_web_page_preview: true
    });
  });

  it("reports missing credentials without calling fetch", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const client = new RealTelegramClient({ fetchImpl });

    await expect(client.sendReviewMessage({
      chatId: "review-chat",
      text: "Review text",
      replyMarkup: buildReviewInlineKeyboard("item_1")
    })).rejects.toMatchObject({
      name: "TelegramClientError",
      category: "missing_credentials"
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("does not expose the bot token or raw Telegram description in API error messages", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      ok: false,
      description: "remote failure with configured-token and https://telegram.local/botconfigured-token/sendMessage"
    }, 401)) as unknown as typeof fetch;
    const client = new RealTelegramClient({
      botToken: "configured-token",
      fetchImpl,
      apiBaseUrl: "https://telegram.local"
    });

    try {
      await client.sendReviewMessage({
        chatId: "review-chat",
        text: "Review text",
        replyMarkup: buildReviewInlineKeyboard("item_1")
      });
      throw new Error("Expected TelegramClientError");
    } catch (error) {
      expect(error).toBeInstanceOf(TelegramClientError);
      expect(error).toMatchObject({
        category: "telegram_api_error",
        message: "Telegram Bot API returned an error.",
        statusCode: 401
      });
      expect(String((error as Error).message)).not.toContain("configured-token");
      expect(String((error as Error).message)).not.toContain("remote failure");
      expect(String((error as Error).message)).not.toContain("telegram.local");
    }
  });

  it("classifies invalid JSON responses", async () => {
    const fetchImpl = vi.fn(async () => new Response("not-json", { status: 200 })) as unknown as typeof fetch;
    const client = new RealTelegramClient({
      botToken: "configured-token",
      fetchImpl,
      apiBaseUrl: "https://telegram.local"
    });

    await expect(client.sendReviewMessage({
      chatId: "review-chat",
      text: "Review text",
      replyMarkup: buildReviewInlineKeyboard("item_1")
    })).rejects.toMatchObject({
      category: "invalid_response"
    });
  });

  it("classifies malformed fetch responses without TypeError", async () => {
    const fetchImpl = vi.fn(async () => undefined) as unknown as typeof fetch;
    const client = new RealTelegramClient({
      botToken: "configured-token",
      fetchImpl,
      apiBaseUrl: "https://telegram.local"
    });

    await expect(client.sendReviewMessage({
      chatId: "review-chat",
      text: "Review text",
      replyMarkup: buildReviewInlineKeyboard("item_1")
    })).rejects.toMatchObject({
      name: "TelegramClientError",
      category: "invalid_response",
      message: "Telegram Bot API returned an invalid response object."
    });
  });

  it("publishes text-only final messages with optional topic id", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(successMessage(100, "final-chat", "Final text"))) as unknown as typeof fetch;
    const client = new RealTelegramClient({
      botToken: "configured-token",
      fetchImpl,
      apiBaseUrl: "https://telegram.local"
    });

    const message = await client.publishFinalMessage({
      chatId: "final-chat",
      messageThreadId: 701,
      text: "Final text"
    });

    expect(message).toMatchObject({ chatId: "final-chat", messageId: "100", text: "Final text", messageThreadId: 701 });
    expect(requestUrl(fetchImpl)).toBe("https://telegram.local/botconfigured-token/sendMessage");
    expect(requestBody(fetchImpl)).toMatchObject({
      chat_id: "final-chat",
      message_thread_id: 701,
      text: "Final text",
      disable_web_page_preview: true
    });
  });

  it("publishes photo final messages", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(successMessage(101, "final-chat", "Photo caption"))) as unknown as typeof fetch;
    const client = new RealTelegramClient({ botToken: "configured-token", fetchImpl, apiBaseUrl: "https://telegram.local" });

    const message = await client.publishFinalMessage({
      chatId: "final-chat",
      text: "Photo caption",
      media: [{ kind: "photo", fileId: "photo-file-id" }]
    });

    expect(message).toMatchObject({ chatId: "final-chat", messageId: "101" });
    expect(requestUrl(fetchImpl)).toBe("https://telegram.local/botconfigured-token/sendPhoto");
    expect(requestBody(fetchImpl)).toMatchObject({
      chat_id: "final-chat",
      photo: "photo-file-id",
      caption: "Photo caption"
    });
  });

  it("publishes video final messages", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(successMessage(102, "final-chat", "Video caption"))) as unknown as typeof fetch;
    const client = new RealTelegramClient({ botToken: "configured-token", fetchImpl, apiBaseUrl: "https://telegram.local" });

    await client.publishFinalMessage({
      chatId: "final-chat",
      text: "Video caption",
      media: [{ kind: "video", fileId: "video-file-id" }]
    });

    expect(requestUrl(fetchImpl)).toBe("https://telegram.local/botconfigured-token/sendVideo");
    expect(requestBody(fetchImpl)).toMatchObject({
      chat_id: "final-chat",
      video: "video-file-id",
      caption: "Video caption"
    });
  });

  it("publishes document final messages", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(successMessage(103, "final-chat", "Document caption"))) as unknown as typeof fetch;
    const client = new RealTelegramClient({ botToken: "configured-token", fetchImpl, apiBaseUrl: "https://telegram.local" });

    await client.publishFinalMessage({
      chatId: "final-chat",
      text: "Document caption",
      media: [{ kind: "document", fileId: "document-file-id" }]
    });

    expect(requestUrl(fetchImpl)).toBe("https://telegram.local/botconfigured-token/sendDocument");
    expect(requestBody(fetchImpl)).toMatchObject({
      chat_id: "final-chat",
      document: "document-file-id",
      caption: "Document caption"
    });
  });

  it("publishes media groups without silently dropping extra valid items", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ ok: true, result: [
      { message_id: 201, chat: { id: "final-chat" }, caption: "Album caption" },
      { message_id: 202, chat: { id: "final-chat" }, caption: "" }
    ] })) as unknown as typeof fetch;
    const client = new RealTelegramClient({ botToken: "configured-token", fetchImpl, apiBaseUrl: "https://telegram.local" });

    await client.publishFinalMessage({
      chatId: "final-chat",
      text: "Album caption",
      media: [
        { kind: "photo", fileId: "photo-1", fileSize: 1024 },
        { kind: "photo", fileId: "photo-2", fileSize: 1024 }
      ]
    });

    expect(requestUrl(fetchImpl)).toBe("https://telegram.local/botconfigured-token/sendMediaGroup");
    const body = requestBody(fetchImpl);
    expect(body).toMatchObject({ chat_id: "final-chat" });
    expect(body.media).toEqual([
      { type: "photo", media: "photo-1", caption: "Album caption" },
      { type: "photo", media: "photo-2" }
    ]);
  });

  it("rejects oversized media before calling Telegram", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const client = new RealTelegramClient({ botToken: "configured-token", fetchImpl, apiBaseUrl: "https://telegram.local" });

    await expect(client.publishFinalMessage({
      chatId: "final-chat",
      text: "Too large",
      media: [{ kind: "video", fileId: "video-file-id", fileSize: 50 * 1024 * 1024 }]
    })).rejects.toMatchObject({ category: "invalid_media" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects media groups larger than Telegram supports instead of truncating them", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const client = new RealTelegramClient({ botToken: "configured-token", fetchImpl, apiBaseUrl: "https://telegram.local" });

    await expect(client.publishFinalMessage({
      chatId: "final-chat",
      text: "Album",
      media: Array.from({ length: 11 }, (_, index) => ({ kind: "photo" as const, fileId: `photo-${index}`, fileSize: 1024 }))
    })).rejects.toMatchObject({ category: "invalid_media" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

});
