import { describe, expect, it } from "vitest";
import { MockTelegramClient } from "./client";
import { buildTelegramAiReviewDraft, createOriginalTextExcerpt } from "./review-message";

describe("Telegram review message flow", () => {
  it("formats a review message with AI output and management buttons", () => {
    const draft = buildTelegramAiReviewDraft({
      itemId: "item-local",
      status: "queued_for_ai",
      sourceUrl: "https://source.local/post",
      aiOutput: {
        headline: "Headline",
        rewrittenPersianCaption: "کپشن فارسی برای بررسی",
        shortSummary: "Summary",
        language: "fa",
        riskFlags: ["needs_review"],
        relevanceScore: 0.81,
        suggestedHashtags: ["#AI", "#Tech"],
        sourceAttributionText: "Source: https://source.local/post"
      },
      originalTextExcerpt: "Original text excerpt",
      provider: "mock_social_provider",
      platform: "manual",
      sourceType: "web_url"
    });

    expect(draft.text).toContain("کپشن فارسی");
    expect(draft.text).toContain("https://source.local/post");
    expect(draft.text).toContain("Summary");
    expect(draft.text).toContain("needs_review");
    expect(draft.text).toContain("mock_social_provider / manual / web_url");
    expect(draft.reply_markup.inline_keyboard.flat().map((button) => button.text)).toEqual([
      "Edit",
      "Send",
      "Cancel",
      "Status"
    ]);
  });

  it("sends review messages through MockTelegramClient", async () => {
    const client = new MockTelegramClient();
    const draft = buildTelegramAiReviewDraft({
      itemId: "item-local",
      status: "queued_for_ai",
      sourceUrl: "https://source.local/post",
      aiOutput: {
        headline: "Headline",
        rewrittenPersianCaption: "کپشن فارسی",
        shortSummary: "Summary",
        language: "fa",
        riskFlags: [],
        relevanceScore: 0.8,
        suggestedHashtags: [],
        sourceAttributionText: "Source"
      }
    });

    const message = await client.sendReviewMessage({
      chatId: "review-chat-local",
      text: draft.text,
      replyMarkup: draft.reply_markup
    });

    expect(message.chatId).toBe("review-chat-local");
    expect(message.messageId).toBe("mock_telegram_review_1");
    expect(client.sentReviewMessages).toHaveLength(1);
    expect(client.sentReviewMessages[0]?.text).toContain("کپشن فارسی");
  });

  it("creates bounded original text excerpts", () => {
    expect(createOriginalTextExcerpt("short text", 20)).toBe("short text");
    expect(createOriginalTextExcerpt("abcdefghijklmnopqrstuvwxyz", 10)).toBe("abcdefghi…");
    expect(createOriginalTextExcerpt("   ")).toBeUndefined();
  });
});
