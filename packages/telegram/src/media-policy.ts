import type { ParsedTelegramMedia } from "./index";

export const TELEGRAM_SAFE_PHOTO_MAX_BYTES = 9 * 1024 * 1024;
export const TELEGRAM_SAFE_FILE_MAX_BYTES = 49 * 1024 * 1024;
export const TELEGRAM_MEDIA_GROUP_MIN_ITEMS = 2;
export const TELEGRAM_MEDIA_GROUP_MAX_ITEMS = 10;

export type TelegramMediaPolicyValidation =
  | { ok: true; warnings: string[] }
  | { ok: false; code: "telegram_media_group_size" | "telegram_media_too_large" | "telegram_media_group_mixed_documents"; errorMessage: string; warnings: string[] };

export function validateTelegramPublishMedia(media: ParsedTelegramMedia[] | undefined): TelegramMediaPolicyValidation {
  const entries = media ?? [];
  const warnings = entries
    .map((entry, index) => entry.fileSize === undefined ? `Media ${index + 1} has no Telegram file size metadata; file_id reuse will be attempted.` : undefined)
    .filter((entry): entry is string => entry !== undefined);

  if (entries.length > 1) {
    if (entries.length < TELEGRAM_MEDIA_GROUP_MIN_ITEMS || entries.length > TELEGRAM_MEDIA_GROUP_MAX_ITEMS) {
      return {
        ok: false,
        code: "telegram_media_group_size",
        warnings,
        errorMessage: `Telegram media groups must contain ${TELEGRAM_MEDIA_GROUP_MIN_ITEMS}-${TELEGRAM_MEDIA_GROUP_MAX_ITEMS} items. This output has ${entries.length}.`
      };
    }

    const hasDocument = entries.some((entry) => entry.kind === "document");
    const hasNonDocument = entries.some((entry) => entry.kind !== "document");
    if (hasDocument && hasNonDocument) {
      return {
        ok: false,
        code: "telegram_media_group_mixed_documents",
        warnings,
        errorMessage: "Telegram document media groups must not be mixed with photo or video media."
      };
    }
  }

  return validateMediaSizes(entries, warnings);
}

function validateMediaSizes(entries: ParsedTelegramMedia[], warnings: string[]): TelegramMediaPolicyValidation {
  for (const [index, entry] of entries.entries()) {
    if (entry.fileSize === undefined) {
      continue;
    }

    const limit = entry.kind === "photo" ? TELEGRAM_SAFE_PHOTO_MAX_BYTES : TELEGRAM_SAFE_FILE_MAX_BYTES;
    if (entry.fileSize > limit) {
      return {
        ok: false,
        code: "telegram_media_too_large",
        warnings,
        errorMessage: `Telegram ${entry.kind} at position ${index + 1} is too large for safe Bot API upload/reuse validation. Limit is ${formatMegabytes(limit)} MB, got ${formatMegabytes(entry.fileSize)} MB.`
      };
    }
  }

  return { ok: true, warnings };
}

function formatMegabytes(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1);
}
