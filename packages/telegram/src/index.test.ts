import { describe, expect, it } from "vitest";
import {
  buildReviewInlineKeyboard,
  buildTelegramOutputCallbackData,
  buildTelegramOutputReviewDraft,
  buildTelegramReviewDraft,
  parseAllowedReviewerIds,
  parseReviewCallbackData,
  parseTelegramOutputCallbackData,
  parseTelegramUpdate
} from "./index";

describe("telegram manual ingest parsing", () => {
  it("parses manual text input with a URL", () => {
    const parsed = parseTelegramUpdate({
      update_id: 1,
      message: {
        message_id: 2,
        from: { id: 3, first_name: "Reviewer" },
        chat: { id: 4, type: "private" },
        text: "Please review https://source.local/post for the channel"
      }
    });

    expect(parsed.kind).toBe("manual_message");
    if (parsed.kind !== "manual_message") {
      throw new Error("Expected manual_message");
    }

    expect(parsed.text).toContain("Please review");
    expect(parsed.urls).toEqual(["https://source.local/post"]);
    expect(parsed.reviewerId).toBe("3");
    expect(parsed.chatId).toBe("4");
    expect(parsed.messageId).toBe(2);
  });

  it("parses forum topic messages with message_thread_id", () => {
    const parsed = parseTelegramUpdate({
      update_id: 10,
      message: {
        message_id: 20,
        message_thread_id: 101,
        from: { id: 30, first_name: "Reviewer" },
        chat: { id: -100111, type: "supergroup", is_forum: true },
        text: "Crypto source https://source.local/crypto"
      }
    });

    expect(parsed.kind).toBe("manual_message");
    if (parsed.kind !== "manual_message") {
      throw new Error("Expected manual_message");
    }

    expect(parsed.chatId).toBe("-100111");
    expect(parsed.threadId).toBe(101);
    expect(parsed.urls).toEqual(["https://source.local/crypto"]);
  });

  it("extracts Telegram media metadata without requiring text", () => {
    const parsed = parseTelegramUpdate({
      update_id: 11,
      message: {
        message_id: 21,
        message_thread_id: 102,
        media_group_id: "album-local",
        from: { id: 31, first_name: "Reviewer" },
        chat: { id: -100111, type: "supergroup", is_forum: true },
        photo: [
          { file_id: "small", file_unique_id: "small-u", width: 90, height: 90, file_size: 100 },
          { file_id: "large", file_unique_id: "large-u", width: 1080, height: 720, file_size: 5000 }
        ]
      }
    });

    expect(parsed.kind).toBe("manual_message");
    if (parsed.kind !== "manual_message") {
      throw new Error("Expected manual_message");
    }

    expect(parsed.media).toEqual([
      {
        kind: "photo",
        fileId: "large",
        fileUniqueId: "large-u",
        mediaGroupId: "album-local",
        fileSize: 5000,
        width: 1080,
        height: 720
      }
    ]);
  });

  it("extracts video and document metadata", () => {
    const parsed = parseTelegramUpdate({
      message: {
        message_id: 22,
        message_thread_id: 103,
        from: { id: 32, first_name: "Reviewer" },
        chat: { id: -100111, type: "supergroup", is_forum: true },
        caption: "Media caption",
        video: { file_id: "video-file", file_unique_id: "video-u", width: 1280, height: 720, duration: 30, mime_type: "video/mp4", file_size: 4096 },
        document: { file_id: "doc-file", file_unique_id: "doc-u", file_name: "report.pdf", mime_type: "application/pdf", file_size: 2048 }
      }
    });

    expect(parsed.kind).toBe("manual_message");
    if (parsed.kind !== "manual_message") {
      throw new Error("Expected manual_message");
    }

    expect(parsed.media.map((entry) => entry.kind)).toEqual(["video", "document"]);
    expect(parsed.media[0]).toMatchObject({ fileId: "video-file", mimeType: "video/mp4", durationSeconds: 30 });
    expect(parsed.media[1]).toMatchObject({ fileId: "doc-file", fileName: "report.pdf", mimeType: "application/pdf" });
  });

  it("parses review callback routing data", () => {
    const parsed = parseTelegramUpdate({
      callback_query: {
        id: "callback-local",
        from: { id: 5, first_name: "Reviewer" },
        message: { message_id: 6, chat: { id: 7, type: "private" } },
        data: "review:send:item_local"
      }
    });

    expect(parsed.kind).toBe("callback");
    if (parsed.kind !== "callback") {
      throw new Error("Expected callback");
    }

    expect(parsed.action).toBe("send");
    expect(parsed.itemId).toBe("item_local");
    expect(parsed.reviewerId).toBe("5");
  });

  it("parses output-level callback routing data", () => {
    const callbackData = buildTelegramOutputCallbackData("send", "tgout_local");
    expect(callbackData).toBe("tgout:send:tgout_local");
    expect(parseTelegramOutputCallbackData(callbackData)).toEqual({ action: "send", token: "tgout_local" });
    expect(parseTelegramOutputCallbackData(buildTelegramOutputCallbackData("edit", "tgout_local"))).toEqual({ action: "edit", token: "tgout_local" });

    const parsed = parseTelegramUpdate({
      callback_query: {
        id: "output-callback-local",
        from: { id: 55, first_name: "Reviewer" },
        message: { message_id: 66, chat: { id: 77, type: "supergroup" } },
        data: callbackData
      }
    });

    expect(parsed.kind).toBe("output_callback");
    if (parsed.kind !== "output_callback") {
      throw new Error("Expected output_callback");
    }
    expect(parsed.action).toBe("send");
    expect(parsed.token).toBe("tgout_local");
  });

  it("rejects unsupported callback data", () => {
    expect(parseReviewCallbackData("unknown:send:item_local")).toBeNull();
    expect(parseReviewCallbackData("review:publish:item_local")).toBeNull();
    expect(parseTelegramOutputCallbackData("tgout:publish:tgout_local")).toBeNull();
  });

  it("builds the Phase 2 review keyboard", () => {
    const keyboard = buildReviewInlineKeyboard("item_local");

    expect(keyboard.inline_keyboard.flat().map((button) => button.text)).toEqual([
      "Edit",
      "Send",
      "Cancel",
      "Status"
    ]);
  });

  it("builds a review draft with caption, source, and status", () => {
    const draft = buildTelegramReviewDraft({
      itemId: "item_local",
      caption: "Manual caption",
      sourceUrl: "https://source.local/post",
      status: "sent_to_review",
      links: ["https://source.local/post"]
    });

    expect(draft.text).toContain("Manual review draft");
    expect(draft.text).toContain("Manual caption");
    expect(draft.text).toContain("sent_to_review");
    expect(draft.reply_markup.inline_keyboard).toHaveLength(2);
  });

  it("builds an output-level topic review draft", () => {
    const draft = buildTelegramOutputReviewDraft({
      generatedOutputId: "tgout_local",
      category: "crypto",
      language: "fa",
      itemId: "item_local",
      sourceUrl: "https://source.local/post",
      originalExcerpt: "Original text",
      caption: "Generated caption",
      summary: "Generated summary",
      riskFlags: [],
      status: "ready_for_review",
      callbackToken: "tgout_local"
    });

    expect(draft.text).toContain("Generated caption");
    expect(draft.text).toContain("🔴 Review controls");
    expect(draft.text).toContain("Category: crypto");
    expect(draft.text).toContain("Language: fa");
    expect(draft.text).toContain("Timezone: UTC");
    expect(draft.text).toContain("Minimum gap: 0 minutes");
    expect(draft.text).not.toContain("Telegram topic review draft");
    expect(draft.text).not.toContain("Summary:");
    expect(draft.text).not.toContain("Original excerpt:");
    expect(draft.reply_markup.inline_keyboard.flat().map((button) => button.text)).toEqual(["✅ Send", "🕒 Schedule", "✏️ Edit", "ℹ️ Status", "❌ Cancel"]);
  });

  it("parses comma-separated reviewer allowlists", () => {
    expect(Array.from(parseAllowedReviewerIds("alpha, beta, gamma"))).toEqual(["alpha", "beta", "gamma"]);
  });
});
