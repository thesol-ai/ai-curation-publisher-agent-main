import type {
  AnswerCallbackQueryInput,
  EditReviewMessageInput,
  EditReviewMessageReplyMarkupInput,
  PublishFinalMessageInput,
  SendReviewMessageInput,
  TelegramClient,
  TelegramClientMessage
} from "./client";
import type { ParsedTelegramMedia } from "./index";
import { validateTelegramPublishMedia } from "./media-policy";

export type TelegramClientErrorCategory =
  | "missing_credentials"
  | "telegram_api_error"
  | "network_error"
  | "invalid_response"
  | "invalid_media";

export type TelegramClientErrorDetails = {
  category: TelegramClientErrorCategory;
  message: string;
  statusCode?: number;
  cause?: unknown;
};

export class TelegramClientError extends Error {
  readonly category: TelegramClientErrorCategory;
  readonly statusCode: number | undefined;
  readonly cause: unknown;

  constructor(details: TelegramClientErrorDetails) {
    super(details.message);
    this.name = "TelegramClientError";
    this.category = details.category;
    this.statusCode = details.statusCode;
    this.cause = details.cause;
  }
}

export type TelegramFetch = typeof fetch;

export type RealTelegramClientOptions = {
  botToken?: string;
  fetchImpl?: TelegramFetch;
  apiBaseUrl?: string;
};

type TelegramApiResponse = {
  ok?: unknown;
  description?: unknown;
  result?: unknown;
};

type TelegramApiMessage = {
  message_id?: unknown;
  chat?: {
    id?: unknown;
  };
  text?: unknown;
  caption?: unknown;
};

export class RealTelegramClient implements TelegramClient {
  private readonly botToken: string | undefined;
  private readonly fetchImpl: TelegramFetch;
  private readonly apiBaseUrl: string;

  constructor(options: RealTelegramClientOptions) {
    this.botToken = options.botToken?.trim();
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
    this.apiBaseUrl = options.apiBaseUrl ?? "https://api.telegram.org";
  }

  async sendReviewMessage(input: SendReviewMessageInput): Promise<TelegramClientMessage> {
    const media = input.media ?? [];
    const mediaPreviewCaption = truncateTelegramCaption(sanitizeReviewCaptionForTelegram(input.mediaPreviewCaption?.trim() || input.text));
    let mediaPreviewSent = false;
    let mediaPreviewError: string | undefined;

    if (media.length > 0) {
      try {
        const mediaValidation = validateTelegramPublishMedia(media);
        if (!mediaValidation.ok) {
          throw new TelegramClientError({
            category: "invalid_media",
            message: mediaValidation.errorMessage
          });
        }

        if (media.length > 1) {
          await this.callTelegramApi<TelegramApiMessage[]>("sendMediaGroup", {
            chat_id: input.chatId,
            ...(input.messageThreadId === undefined ? {} : { message_thread_id: input.messageThreadId }),
            media: media.map((entry, index) => ({
              type: telegramInputMediaType(entry),
              media: entry.fileId,
              ...telegramInputMediaMetadata(entry),
              ...(index === 0 ? { caption: mediaPreviewCaption } : {})
            }))
          });
        } else {
          const firstMedia = media[0]!;
          const method = telegramMethodForMedia(firstMedia);
          const mediaField = telegramMediaFieldForMedia(firstMedia);

          await this.callTelegramApi<TelegramApiMessage>(method, {
            chat_id: input.chatId,
            ...(input.messageThreadId === undefined ? {} : { message_thread_id: input.messageThreadId }),
            [mediaField]: firstMedia.fileId,
            ...telegramSendMediaMetadata(firstMedia),
            caption: mediaPreviewCaption
          });
        }

        mediaPreviewSent = true;
      } catch (error) {
        mediaPreviewError = describeTelegramNetworkError(error);
      }
    }

    const result = await this.callTelegramApi<TelegramApiMessage>("sendMessage", {
      chat_id: input.chatId,
      ...(input.messageThreadId === undefined ? {} : { message_thread_id: input.messageThreadId }),
      text: media.length > 0 ? buildReviewControlText(input.text, input.sourceUrl, {
        mediaPreviewSent,
        ...(mediaPreviewError === undefined ? {} : { mediaPreviewError })
      }) : input.text,
      reply_markup: input.replyMarkup,
      disable_web_page_preview: true
    });

    return toTelegramClientMessage(result, input.chatId, input.text, input.replyMarkup, input.messageThreadId);
  }

  async editReviewMessage(input: EditReviewMessageInput): Promise<TelegramClientMessage> {
    const result = await this.callTelegramApi<TelegramApiMessage>("editMessageText", {
      chat_id: input.chatId,
      message_id: input.messageId,
      text: input.text,
      ...(input.replyMarkup === undefined ? {} : { reply_markup: input.replyMarkup }),
      disable_web_page_preview: true
    });

    return toTelegramClientMessage(result, input.chatId, input.text, input.replyMarkup);
  }

  async editReviewMessageReplyMarkup(input: EditReviewMessageReplyMarkupInput): Promise<TelegramClientMessage> {
    const result = await this.callTelegramApi<TelegramApiMessage>("editMessageReplyMarkup", {
      chat_id: input.chatId,
      message_id: input.messageId,
      reply_markup: input.replyMarkup
    });

    return toTelegramClientMessage(result, input.chatId, "", input.replyMarkup);
  }

  async publishFinalMessage(input: PublishFinalMessageInput): Promise<TelegramClientMessage> {
    const media = input.media ?? [];
    const mediaValidation = validateTelegramPublishMedia(media);
    if (!mediaValidation.ok) {
      throw new TelegramClientError({
        category: "invalid_media",
        message: mediaValidation.errorMessage
      });
    }

    if (media.length === 0) {
      const result = await this.callTelegramApi<TelegramApiMessage>("sendMessage", {
        chat_id: input.chatId,
        ...(input.messageThreadId === undefined ? {} : { message_thread_id: input.messageThreadId }),
        text: input.text,
        disable_web_page_preview: true
      });
      return toTelegramClientMessage(result, input.chatId, input.text, undefined, input.messageThreadId);
    }

    if (media.length > 1) {
      const result = await this.callTelegramApi<TelegramApiMessage[]>("sendMediaGroup", {
        chat_id: input.chatId,
        ...(input.messageThreadId === undefined ? {} : { message_thread_id: input.messageThreadId }),
        media: media.map((entry, index) => ({
          type: telegramInputMediaType(entry),
          media: entry.fileId,
          ...telegramInputMediaMetadata(entry),
          ...(index === 0 ? { caption: input.text } : {})
        }))
      });
      const firstResult = result[0];
      if (firstResult === undefined) {
        throw new TelegramClientError({ category: "invalid_response", message: "Telegram Bot API response did not include a media group message." });
      }
      return toTelegramClientMessage(firstResult, input.chatId, input.text, undefined, input.messageThreadId);
    }

    const firstMedia = media[0]!;
    const method = telegramMethodForMedia(firstMedia);
    const mediaField = telegramMediaFieldForMedia(firstMedia);
    const result = await this.callTelegramApi<TelegramApiMessage>(method, {
      chat_id: input.chatId,
      ...(input.messageThreadId === undefined ? {} : { message_thread_id: input.messageThreadId }),
      [mediaField]: firstMedia.fileId,
      ...telegramSendMediaMetadata(firstMedia),
      caption: input.text
    });

    return toTelegramClientMessage(result, input.chatId, input.text, undefined, input.messageThreadId);
  }

  async answerCallbackQuery(input: AnswerCallbackQueryInput): Promise<void> {
    await this.callTelegramApi<unknown>("answerCallbackQuery", {
      callback_query_id: input.callbackQueryId,
      text: input.text
    });
  }

  private async callTelegramApi<T>(method: string, body: Record<string, unknown>): Promise<T> {
    if (!this.botToken) {
      throw new TelegramClientError({
        category: "missing_credentials",
        message: "Telegram bot token is not configured."
      });
    }

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.apiBaseUrl}/bot${this.botToken}/${method}`, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(body)
      });
    } catch (error) {
      throw new TelegramClientError({
        category: "network_error",
        message: describeTelegramNetworkError(error),
        cause: error
      });
    }

    if (!isResponseLike(response)) {
      throw new TelegramClientError({
        category: "invalid_response",
        message: "Telegram Bot API returned an invalid response object."
      });
    }

    let payload: TelegramApiResponse;
    try {
      payload = await response.json() as TelegramApiResponse;
    } catch (error) {
      throw new TelegramClientError({
        category: "invalid_response",
        message: "Telegram Bot API returned invalid JSON.",
        statusCode: response.status,
        cause: error
      });
    }

    if (!response.ok || payload.ok !== true) {
      throw new TelegramClientError({
        category: "telegram_api_error",
        message: redactTelegramApiError(payload.description),
        statusCode: response.status
      });
    }

    if (payload.result === undefined || payload.result === null) {
      throw new TelegramClientError({
        category: "invalid_response",
        message: "Telegram Bot API response did not include a result.",
        statusCode: response.status
      });
    }

    return payload.result as T;
  }
}

function sanitizeReviewCaptionForTelegram(value: string): string {
  return value
    .replace(/این خروجی fallback است چون پاسخ AI با ساختار مورد انتظار سازگار نبود\.?/g, "")
    .replace(/خطا:\s*Gemini API request failed[^\n]*/gi, "")
    .replace(/Gemini API request failed[^\n]*/gi, "")
    .replace(/HTTP 503[^\n]*/gi, "")
    .replace(/Invalid Telegram AI output:[^\n]*/gi, "")
    .replace(/Output must be valid JSON\.?/gi, "")
    .replace(/Source:\s*https?:\/\/\S+/gi, "")
    .replace(/منبع:\s*https?:\/\/\S+/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function truncateTelegramCaption(value: string): string {
  const maxLength = 1000;
  const trimmed = value.trim();
  return trimmed.length <= maxLength ? trimmed : `${trimmed.slice(0, maxLength - 1).trimEnd()}…`;
}

function buildReviewControlText(reviewText: string, _sourceUrl?: string, mediaPreview?: { mediaPreviewSent: boolean; mediaPreviewError?: string }): string {
  const category = extractReviewField(reviewText, "Category") ?? "unknown";
  const language = extractReviewField(reviewText, "Language") ?? "unknown";
  const timezone = extractReviewPublishingField(reviewText, "Timezone") ?? "unknown";
  const minimumGap = extractReviewPublishingField(reviewText, "Minimum gap") ?? "unknown";

  const mediaStatus = mediaPreview && !mediaPreview.mediaPreviewSent
    ? [`⚠️ Media preview failed. Controls are still available.`, mediaPreview.mediaPreviewError ? `Reason: ${mediaPreview.mediaPreviewError}` : undefined, ""]
    : [];

  return [
    ...mediaStatus.filter((entry): entry is string => typeof entry === "string"),
    "🔴 Review controls",
    "",
    `Category: ${category}`,
    `Language: ${language}`,
    `Timezone: ${timezone}`,
    `Minimum gap: ${minimumGap}`
  ].join("\n");
}

function extractReviewField(reviewText: string, field: string): string | undefined {
  const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = reviewText.match(new RegExp(`^${escaped}:\\s*(.+)$`, "m"));
  return match?.[1]?.trim();
}

function extractReviewPublishingField(reviewText: string, field: string): string | undefined {
  const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = reviewText.match(new RegExp(`^${escaped}:\\s*(.+)$`, "m"));
  return match?.[1]?.trim();
}


function telegramInputMediaMetadata(media: ParsedTelegramMedia): Record<string, unknown> {
  if (media.kind !== "video" && media.kind !== "animation") return {};
  return {
    supports_streaming: true,
    ...(media.width === undefined ? {} : { width: media.width }),
    ...(media.height === undefined ? {} : { height: media.height }),
    ...(media.durationSeconds === undefined ? {} : { duration: Math.max(1, Math.round(media.durationSeconds)) })
  };
}

function telegramSendMediaMetadata(media: ParsedTelegramMedia): Record<string, unknown> {
  if (media.kind !== "video" && media.kind !== "animation") return {};
  return {
    supports_streaming: true,
    ...(media.width === undefined ? {} : { width: media.width }),
    ...(media.height === undefined ? {} : { height: media.height }),
    ...(media.durationSeconds === undefined ? {} : { duration: Math.max(1, Math.round(media.durationSeconds)) })
  };
}

function telegramMethodForMedia(media: ParsedTelegramMedia): "sendPhoto" | "sendVideo" | "sendDocument" {
  if (media.kind === "photo") return "sendPhoto";
  if (media.kind === "video" || media.kind === "animation") return "sendVideo";
  return "sendDocument";
}

function telegramInputMediaType(media: ParsedTelegramMedia): "photo" | "video" | "document" {
  if (media.kind === "photo") return "photo";
  if (media.kind === "video" || media.kind === "animation") return "video";
  return "document";
}

function telegramMediaFieldForMedia(media: ParsedTelegramMedia): "photo" | "video" | "document" {
  if (media.kind === "photo") return "photo";
  if (media.kind === "video" || media.kind === "animation") return "video";
  return "document";
}

function describeTelegramNetworkError(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return `Telegram Bot API request failed before receiving a response: ${redactTelegramNetworkDetail(error.name)}: ${redactTelegramNetworkDetail(error.message)}`;
  }
  return "Telegram Bot API request failed before receiving a response.";
}

function redactTelegramNetworkDetail(value: string): string {
  return value
    .replace(/bot\d+:[A-Za-z0-9_-]+/g, "bot<redacted>")
    .replace(/https:\/\/api\.telegram\.org\/[^\s]+/g, "https://api.telegram.org/<redacted>");
}

export function redactTelegramApiError(_description: unknown): string {
  return "Telegram Bot API returned an error.";
}

function isResponseLike(value: unknown): value is Response {
  return typeof value === "object"
    && value !== null
    && "ok" in value
    && "status" in value
    && typeof (value as { json?: unknown }).json === "function";
}

function toTelegramClientMessage(
  result: TelegramApiMessage,
  fallbackChatId: string,
  text: string,
  replyMarkup: TelegramClientMessage["replyMarkup"],
  messageThreadId?: number
): TelegramClientMessage {
  if (typeof result.message_id !== "number") {
    throw new TelegramClientError({
      category: "invalid_response",
      message: "Telegram Bot API response did not include a numeric message id."
    });
  }

  const chatId = result.chat?.id === undefined ? fallbackChatId : String(result.chat.id);

  return {
    chatId,
    messageId: String(result.message_id),
    text: typeof result.text === "string" ? result.text : typeof result.caption === "string" ? result.caption : text,
    ...(messageThreadId === undefined ? {} : { messageThreadId }),
    ...(replyMarkup === undefined ? {} : { replyMarkup })
  };
}
