export const TELEGRAM_REVIEW_ACTIONS = ["edit", "send", "cancel", "status"] as const;
export type TelegramReviewAction = typeof TELEGRAM_REVIEW_ACTIONS[number];

export const TELEGRAM_OUTPUT_REVIEW_ACTIONS = ["send", "cancel", "status", "schedule", "edit"] as const;
export type TelegramOutputReviewAction = typeof TELEGRAM_OUTPUT_REVIEW_ACTIONS[number];

export type TelegramWebhookAck = {
  ok: true;
  receivedUpdateId?: number;
  kind?: ParsedTelegramUpdate["kind"];
  itemId?: string;
  callbackAction?: TelegramReviewAction | TelegramOutputReviewAction;
};

export type TelegramUser = {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
};

export type TelegramChat = {
  id: number | string;
  type?: string;
  title?: string;
  username?: string;
  is_forum?: boolean;
};

export type TelegramMessageEntity = {
  type: string;
  offset: number;
  length: number;
  url?: string;
};

export type TelegramPhotoSize = {
  file_id: string;
  file_unique_id?: string;
  width: number;
  height: number;
  file_size?: number;
};

export type TelegramVideo = {
  file_id: string;
  file_unique_id?: string;
  width?: number;
  height?: number;
  duration?: number;
  mime_type?: string;
  file_size?: number;
};

export type TelegramDocument = {
  file_id: string;
  file_unique_id?: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
};

export type TelegramAnimation = TelegramVideo & {
  file_name?: string;
};

export type TelegramMessage = {
  message_id: number;
  message_thread_id?: number;
  media_group_id?: string;
  from?: TelegramUser;
  chat: TelegramChat;
  date?: number;
  text?: string;
  caption?: string;
  entities?: TelegramMessageEntity[];
  caption_entities?: TelegramMessageEntity[];
  photo?: TelegramPhotoSize[];
  video?: TelegramVideo;
  document?: TelegramDocument;
  animation?: TelegramAnimation;
  reply_to_message?: TelegramMessage;
};

export type TelegramCallbackMessage = {
  message_id: number;
  message_thread_id?: number;
  chat: TelegramChat;
};

export type TelegramCallbackQuery = {
  id: string;
  from: TelegramUser;
  message?: TelegramCallbackMessage;
  data?: string;
};

export type TelegramUpdate = {
  update_id?: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
};

export type ParsedTelegramMedia = {
  kind: "photo" | "video" | "document" | "animation";
  fileId: string;
  fileUniqueId?: string;
  mediaGroupId?: string;
  mimeType?: string;
  fileSize?: number;
  width?: number;
  height?: number;
  durationSeconds?: number;
  fileName?: string;
};

export type ParsedManualTelegramMessage = {
  kind: "manual_message";
  updateId?: number;
  message: TelegramMessage;
  reviewerId: string;
  chatId: string;
  messageId: number;
  threadId?: number;
  text: string;
  urls: string[];
  media: ParsedTelegramMedia[];
};

export type ParsedTelegramCallback = {
  kind: "callback";
  updateId?: number;
  callback: TelegramCallbackQuery;
  reviewerId: string;
  itemId: string;
  action: TelegramReviewAction;
};

export type ParsedTelegramOutputCallback = {
  kind: "output_callback";
  updateId?: number;
  callback: TelegramCallbackQuery;
  reviewerId: string;
  token: string;
  action: TelegramOutputReviewAction;
};

export type IgnoredTelegramUpdate = {
  kind: "ignored";
  updateId?: number;
  reason: string;
};

export type ParsedTelegramUpdate = ParsedManualTelegramMessage | ParsedTelegramCallback | ParsedTelegramOutputCallback | IgnoredTelegramUpdate;

export type TelegramInlineKeyboardButton = {
  text: string;
  callback_data?: string;
  url?: string;
};

export type TelegramInlineKeyboardMarkup = {
  inline_keyboard: TelegramInlineKeyboardButton[][];
};

export type TelegramReviewDraft = {
  text: string;
  reply_markup: TelegramInlineKeyboardMarkup;
};

export type BuildTelegramReviewDraftInput = {
  itemId: string;
  caption: string;
  sourceUrl: string;
  status: string;
  links: string[];
};

export type BuildTelegramOutputReviewDraftInput = {
  generatedOutputId: string;
  category: string;
  language: string;
  itemId: string;
  sourceUrl: string;
  originalExcerpt?: string;
  caption: string;
  summary?: string;
  riskFlags: string[];
  status: string;
  callbackToken: string;
  scheduleSummary?: string;
  mediaSummary?: string;
  publishMode?: string;
  timezone?: string;
  allowedPublishWindows?: string[];
  minimumGapMinutes?: number;
  sourceButtonUrl?: string;
  hasPreviewMedia?: boolean;
};

export type TelegramOutputReviewKeyboardState = {
  callbackToken: string;
  generatedStatus: string;
  publishQueueStatus?: string;
  scheduledFor?: string;
  finalMessageId?: string;
  lastError?: string;
  finalPublishingEnabled?: boolean;
  sourceButtonUrl?: string;
  editRequested?: boolean;
};

export function parseAllowedReviewerIds(raw: string | undefined): Set<string> {
  if (!raw) {
    return new Set();
  }

  return new Set(raw.split(",").map((value) => value.trim()).filter((value) => value.length > 0));
}

export function isReviewerAllowed(reviewerId: string, allowedReviewerIds: Set<string>): boolean {
  return allowedReviewerIds.has(reviewerId);
}

export function getTelegramMessageText(message: TelegramMessage): string {
  return (message.text ?? message.caption ?? "").trim();
}

export function extractUrls(text: string): string[] {
  const matches = text.matchAll(/https?:\/\/[^\s<>()]+/gi);
  const urls = Array.from(matches, (match) => match[0].replace(/[),.;:!?]+$/, ""));
  return Array.from(new Set(urls));
}

export function parseTelegramUpdate(update: TelegramUpdate): ParsedTelegramUpdate {
  const updateFields: Pick<ParsedTelegramUpdate, "updateId"> = update.update_id === undefined ? {} : { updateId: update.update_id };

  if (update.callback_query) {
    const parsedOutputCallback = parseTelegramOutputCallbackData(update.callback_query.data ?? "");
    if (parsedOutputCallback) {
      return {
        kind: "output_callback",
        ...updateFields,
        callback: update.callback_query,
        reviewerId: String(update.callback_query.from.id),
        action: parsedOutputCallback.action,
        token: parsedOutputCallback.token
      };
    }

    const parsedCallback = parseReviewCallbackData(update.callback_query.data ?? "");
    if (!parsedCallback) {
      return { kind: "ignored", ...updateFields, reason: "unsupported_callback_data" };
    }

    return {
      kind: "callback",
      ...updateFields,
      callback: update.callback_query,
      reviewerId: String(update.callback_query.from.id),
      action: parsedCallback.action,
      itemId: parsedCallback.itemId
    };
  }

  const message = update.message ?? update.edited_message;
  if (!message) {
    return { kind: "ignored", ...updateFields, reason: "unsupported_update" };
  }

  const text = getTelegramMessageText(message);
  const media = extractTelegramMedia(message);
  if (!text && media.length === 0) {
    return { kind: "ignored", ...updateFields, reason: "empty_message" };
  }

  if (!message.from) {
    return { kind: "ignored", ...updateFields, reason: "missing_sender" };
  }

  return {
    kind: "manual_message",
    ...updateFields,
    message,
    reviewerId: String(message.from.id),
    chatId: String(message.chat.id),
    messageId: message.message_id,
    ...(message.message_thread_id === undefined ? {} : { threadId: message.message_thread_id }),
    text,
    urls: extractUrls(text),
    media
  };
}

export function extractTelegramMedia(message: TelegramMessage): ParsedTelegramMedia[] {
  const media: ParsedTelegramMedia[] = [];
  const mediaGroupFields = message.media_group_id === undefined ? {} : { mediaGroupId: message.media_group_id };

  const photo = largestPhoto(message.photo);
  if (photo) {
    media.push({
      kind: "photo",
      fileId: photo.file_id,
      ...(photo.file_unique_id === undefined ? {} : { fileUniqueId: photo.file_unique_id }),
      ...mediaGroupFields,
      ...(photo.file_size === undefined ? {} : { fileSize: photo.file_size }),
      width: photo.width,
      height: photo.height
    });
  }

  if (message.video) {
    media.push(videoLikeToMedia("video", message.video, mediaGroupFields));
  }

  if (message.animation) {
    media.push(videoLikeToMedia("animation", message.animation, mediaGroupFields));
  }

  if (message.document) {
    media.push({
      kind: "document",
      fileId: message.document.file_id,
      ...(message.document.file_unique_id === undefined ? {} : { fileUniqueId: message.document.file_unique_id }),
      ...mediaGroupFields,
      ...(message.document.mime_type === undefined ? {} : { mimeType: message.document.mime_type }),
      ...(message.document.file_size === undefined ? {} : { fileSize: message.document.file_size }),
      ...(message.document.file_name === undefined ? {} : { fileName: message.document.file_name })
    });
  }

  return media;
}

export function buildReviewCallbackData(action: TelegramReviewAction, itemId: string): string {
  return `review:${action}:${itemId}`;
}

export function parseReviewCallbackData(data: string): { action: TelegramReviewAction; itemId: string } | null {
  const [namespace, action, ...itemIdParts] = data.split(":");
  const itemId = itemIdParts.join(":");

  if (namespace !== "review" || !isTelegramReviewAction(action) || itemId.length === 0) {
    return null;
  }

  return { action, itemId };
}

export function buildTelegramOutputCallbackData(action: TelegramOutputReviewAction, token: string): string {
  return `tgout:${action}:${token}`;
}

export function parseTelegramOutputCallbackData(data: string): { action: TelegramOutputReviewAction; token: string } | null {
  const [namespace, action, ...tokenParts] = data.split(":");
  const token = tokenParts.join(":");
  if (namespace !== "tgout" || !isTelegramOutputReviewAction(action) || token.length === 0) {
    return null;
  }
  return { action, token };
}

export function isTelegramReviewAction(value: string | undefined): value is TelegramReviewAction {
  return TELEGRAM_REVIEW_ACTIONS.includes(value as TelegramReviewAction);
}

export function isTelegramOutputReviewAction(value: string | undefined): value is TelegramOutputReviewAction {
  return TELEGRAM_OUTPUT_REVIEW_ACTIONS.includes(value as TelegramOutputReviewAction);
}

export function buildReviewInlineKeyboard(itemId: string): TelegramInlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: "Edit", callback_data: buildReviewCallbackData("edit", itemId) },
        { text: "Send", callback_data: buildReviewCallbackData("send", itemId) }
      ],
      [
        { text: "Cancel", callback_data: buildReviewCallbackData("cancel", itemId) },
        { text: "Status", callback_data: buildReviewCallbackData("status", itemId) }
      ]
    ]
  };
}

export function buildTelegramOutputReviewInlineKeyboard(callbackToken: string, sourceButtonUrl?: string): TelegramInlineKeyboardMarkup {
  return buildTelegramOutputReviewStatefulInlineKeyboard({
    callbackToken,
    generatedStatus: "ready_for_review",
    ...(sourceButtonUrl === undefined ? {} : { sourceButtonUrl })
  });
}

export function buildTelegramOutputReviewStatefulInlineKeyboard(input: TelegramOutputReviewKeyboardState): TelegramInlineKeyboardMarkup {
  const token = input.callbackToken;
  const status = normalizeReviewStatus(input.generatedStatus, input.publishQueueStatus);
  const inlineKeyboard: TelegramInlineKeyboardButton[][] = [];

  if (status === "ready_for_review" || status === "generated" || status === "approved") {
    inlineKeyboard.push([
      { text: status === "approved" ? "✅ Approved" : "✅ Send", callback_data: buildTelegramOutputCallbackData("send", token) },
      { text: "🕒 Schedule", callback_data: buildTelegramOutputCallbackData("schedule", token) }
    ]);
    inlineKeyboard.push([
      { text: input.editRequested === true ? "✏️ Waiting for reply" : "✏️ Edit", callback_data: buildTelegramOutputCallbackData("edit", token) },
      { text: status === "approved" ? "ℹ️ Approved" : "ℹ️ Status", callback_data: buildTelegramOutputCallbackData("status", token) }
    ]);
    inlineKeyboard.push([{ text: "❌ Cancel", callback_data: buildTelegramOutputCallbackData("cancel", token) }]);
  } else if (status === "queued_for_publish" || status === "pending") {
    inlineKeyboard.push([{ text: input.finalPublishingEnabled === false ? "📥 Queued · final off" : "📥 Queued", callback_data: buildTelegramOutputCallbackData("status", token) }]);
    inlineKeyboard.push([{ text: "ℹ️ Status", callback_data: buildTelegramOutputCallbackData("status", token) }]);
  } else if (status === "scheduled") {
    inlineKeyboard.push([{ text: scheduledButtonLabel(input.scheduledFor), callback_data: buildTelegramOutputCallbackData("status", token) }]);
    inlineKeyboard.push([{ text: "ℹ️ Status", callback_data: buildTelegramOutputCallbackData("status", token) }]);
  } else if (status === "publishing") {
    inlineKeyboard.push([{ text: "🚀 Publishing...", callback_data: buildTelegramOutputCallbackData("status", token) }]);
  } else if (status === "published") {
    inlineKeyboard.push([{ text: finalPublishedLabel(input.finalMessageId), callback_data: buildTelegramOutputCallbackData("status", token) }]);
  } else if (status === "failed") {
    inlineKeyboard.push([{ text: "⚠️ Failed", callback_data: buildTelegramOutputCallbackData("status", token) }]);
    inlineKeyboard.push(input.publishQueueStatus === undefined
      ? [
        { text: "✏️ Edit", callback_data: buildTelegramOutputCallbackData("edit", token) },
        { text: "ℹ️ Details", callback_data: buildTelegramOutputCallbackData("status", token) }
      ]
      : [{ text: "ℹ️ Details", callback_data: buildTelegramOutputCallbackData("status", token) }]);
  } else if (status === "cancelled") {
    inlineKeyboard.push([{ text: "🚫 Cancelled", callback_data: buildTelegramOutputCallbackData("status", token) }]);
  } else {
    inlineKeyboard.push([{ text: `ℹ️ ${status}`, callback_data: buildTelegramOutputCallbackData("status", token) }]);
  }

  if (input.sourceButtonUrl !== undefined && input.sourceButtonUrl.trim().length > 0) {
    inlineKeyboard.push([{ text: "Source", url: input.sourceButtonUrl.trim() }]);
  }

  return { inline_keyboard: inlineKeyboard };
}

function normalizeReviewStatus(generatedStatus: string, publishQueueStatus?: string): string {
  if (generatedStatus === "published" || publishQueueStatus === "published") return "published";
  if (generatedStatus === "failed" || publishQueueStatus === "failed") return "failed";
  if (generatedStatus === "cancelled" || publishQueueStatus === "cancelled") return "cancelled";
  if (generatedStatus === "publishing" || publishQueueStatus === "publishing") return "publishing";
  if (generatedStatus === "scheduled" || publishQueueStatus === "scheduled") return "scheduled";
  if (generatedStatus === "queued_for_publish" || publishQueueStatus === "pending") return "queued_for_publish";
  return generatedStatus || "unknown";
}

function scheduledButtonLabel(value: string | undefined): string {
  if (!value) return "🕒 Scheduled";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "🕒 Scheduled";
  return `🕒 Scheduled ${parsed.toISOString().slice(11, 16)} UTC`;
}

function finalPublishedLabel(finalMessageId: string | undefined): string {
  return finalMessageId && finalMessageId.trim().length > 0 ? `✅ Published #${finalMessageId}` : "✅ Published";
}

export function buildTelegramReviewDraft(input: BuildTelegramReviewDraftInput): TelegramReviewDraft {
  const links = input.links.length > 0 ? input.links.map((link) => `- ${link}`).join("\n") : "- none";

  return {
    text: [
      "Manual review draft",
      "",
      `Item: ${input.itemId}`,
      `Status: ${input.status}`,
      `Source: ${input.sourceUrl}`,
      "",
      "Caption:",
      input.caption,
      "",
      "Links:",
      links
    ].join("\n"),
    reply_markup: buildReviewInlineKeyboard(input.itemId)
  };
}

function buildMinimalReviewText(input: {
  category: string;
  language: string;
  caption: string;
  publishMode: string;
  timezone: string;
  minimumGapMinutes: number;
  hasMedia: boolean;
}): string {
  const controls = [
    "🔴 Review controls",
    "",
    `Category: ${input.category}`,
    `Language: ${input.language}`,
    `Timezone: ${input.timezone}`,
    `Minimum gap: ${input.minimumGapMinutes} minutes`
  ].join("\n");

  if (input.hasMedia) return controls;

  return [
    input.caption,
    "",
    controls
  ].join("\n");
}

export function buildTelegramOutputReviewDraft(input: BuildTelegramOutputReviewDraftInput): TelegramReviewDraft {
  return {
    text: buildMinimalReviewText({
      category: input.category,
      language: input.language,
      caption: input.caption,
      publishMode: input.publishMode ?? "queued",
      timezone: input.timezone ?? "UTC",
      minimumGapMinutes: input.minimumGapMinutes ?? 0,
      hasMedia: input.hasPreviewMedia === true
    }),
    reply_markup: buildTelegramOutputReviewInlineKeyboard(input.callbackToken, input.sourceButtonUrl)
  };
}

function largestPhoto(photos: TelegramPhotoSize[] | undefined): TelegramPhotoSize | undefined {
  if (!photos || photos.length === 0) {
    return undefined;
  }
  return [...photos].sort((left, right) => (right.file_size ?? right.width * right.height) - (left.file_size ?? left.width * left.height))[0];
}

function videoLikeToMedia(kind: "video" | "animation", value: TelegramVideo | TelegramAnimation, mediaGroupFields: { mediaGroupId?: string }): ParsedTelegramMedia {
  return {
    kind,
    fileId: value.file_id,
    ...(value.file_unique_id === undefined ? {} : { fileUniqueId: value.file_unique_id }),
    ...mediaGroupFields,
    ...(value.mime_type === undefined ? {} : { mimeType: value.mime_type }),
    ...(value.file_size === undefined ? {} : { fileSize: value.file_size }),
    ...(value.width === undefined ? {} : { width: value.width }),
    ...(value.height === undefined ? {} : { height: value.height }),
    ...(value.duration === undefined ? {} : { durationSeconds: value.duration }),
    ...("file_name" in value && value.file_name !== undefined ? { fileName: value.file_name } : {})
  };
}

export * from "./client";
export * from "./real-telegram-client";
export * from "./media-policy";
export * from "./review-message";
