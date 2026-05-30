import { describe, expect, it } from "vitest";
import {
  TELEGRAM_SAFE_FILE_MAX_BYTES,
  TELEGRAM_SAFE_PHOTO_MAX_BYTES,
  validateTelegramPublishMedia
} from "./media-policy";

describe("validateTelegramPublishMedia", () => {
  it("accepts text-only and safe Telegram file_id reuse media", () => {
    expect(validateTelegramPublishMedia(undefined)).toMatchObject({ ok: true });
    expect(validateTelegramPublishMedia([{ kind: "photo", fileId: "p1", fileSize: TELEGRAM_SAFE_PHOTO_MAX_BYTES }])).toMatchObject({ ok: true });
    expect(validateTelegramPublishMedia([{ kind: "video", fileId: "v1", fileSize: TELEGRAM_SAFE_FILE_MAX_BYTES }])).toMatchObject({ ok: true });
  });

  it("rejects oversized photos and videos before calling Telegram", () => {
    expect(validateTelegramPublishMedia([{ kind: "photo", fileId: "p1", fileSize: TELEGRAM_SAFE_PHOTO_MAX_BYTES + 1 }])).toMatchObject({ ok: false, code: "telegram_media_too_large" });
    expect(validateTelegramPublishMedia([{ kind: "video", fileId: "v1", fileSize: TELEGRAM_SAFE_FILE_MAX_BYTES + 1 }])).toMatchObject({ ok: false, code: "telegram_media_too_large" });
  });

  it("rejects media groups outside Telegram safe item counts", () => {
    const eleven = Array.from({ length: 11 }, (_, index) => ({ kind: "photo" as const, fileId: `p${index}`, fileSize: 1024 }));
    expect(validateTelegramPublishMedia(eleven)).toMatchObject({ ok: false, code: "telegram_media_group_size" });
  });

  it("rejects mixed document and photo/video albums", () => {
    expect(validateTelegramPublishMedia([
      { kind: "document", fileId: "d1", fileSize: 1024 },
      { kind: "photo", fileId: "p1", fileSize: 1024 }
    ])).toMatchObject({ ok: false, code: "telegram_media_group_mixed_documents" });
  });
});
