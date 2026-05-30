import { buildTelegramReviewDraft, MockTelegramClient, RealTelegramClient, TelegramClientError, type TelegramClient } from "@curator/telegram";
import type { Env } from "../types";

export type TelegramReviewDryRunInput = {
  text: string;
  sourceUrl?: string;
};

export type TelegramReviewDryRunMode = "mock" | "real";

export type TelegramReviewDryRunResult = {
  ok: boolean;
  mode: TelegramReviewDryRunMode;
  reviewMessageSent: boolean;
  chatConfigured: boolean;
  tokenConfigured: boolean;
  realReviewEnabled: boolean;
  telegramMessageId?: string;
  error?: "disabled" | "missing_config" | "missing_credentials" | "telegram_api_error" | "network_error" | "invalid_response" | "invalid_media" | "unknown_error";
  message?: string;
};

export type TelegramReviewDryRunOptions = {
  env: Env;
  input: TelegramReviewDryRunInput;
  client?: TelegramClient;
};

export function isRealTelegramReviewEnabled(env: Pick<Env, "TELEGRAM_REAL_REVIEW_ENABLED">): boolean {
  return env.TELEGRAM_REAL_REVIEW_ENABLED === "true";
}

export async function runTelegramReviewDryRun(options: TelegramReviewDryRunOptions): Promise<TelegramReviewDryRunResult> {
  const realReviewEnabled = isRealTelegramReviewEnabled(options.env);
  const chatConfigured = hasValue(options.env.TELEGRAM_REVIEW_CHAT_ID);
  const tokenConfigured = hasValue(options.env.TELEGRAM_BOT_TOKEN);

  if (!realReviewEnabled) {
    const client = options.client ?? new MockTelegramClient();
    const message = await client.sendReviewMessage({
      chatId: options.env.TELEGRAM_REVIEW_CHAT_ID ?? "mock_review_chat",
      ...buildDryRunDraft(options.input)
    });

    return {
      ok: true,
      mode: "mock",
      reviewMessageSent: true,
      chatConfigured,
      tokenConfigured,
      realReviewEnabled: false,
      telegramMessageId: message.messageId
    };
  }

  if (!tokenConfigured || !chatConfigured) {
    return {
      ok: false,
      mode: "real",
      reviewMessageSent: false,
      chatConfigured,
      tokenConfigured,
      realReviewEnabled: true,
      error: "missing_config",
      message: "Real Telegram review dry-run requires both bot token and review chat configuration."
    };
  }

  const client = options.client ?? new RealTelegramClient({
    ...(options.env.TELEGRAM_BOT_TOKEN === undefined ? {} : { botToken: options.env.TELEGRAM_BOT_TOKEN })
  });

  try {
    const message = await client.sendReviewMessage({
      chatId: options.env.TELEGRAM_REVIEW_CHAT_ID as string,
      ...buildDryRunDraft(options.input)
    });

    return {
      ok: true,
      mode: "real",
      reviewMessageSent: true,
      chatConfigured,
      tokenConfigured,
      realReviewEnabled: true,
      telegramMessageId: message.messageId
    };
  } catch (error) {
    if (error instanceof TelegramClientError) {
      return {
        ok: false,
        mode: "real",
        reviewMessageSent: false,
        chatConfigured,
        tokenConfigured,
        realReviewEnabled: true,
        error: error.category,
        message: error.message
      };
    }

    return {
      ok: false,
      mode: "real",
      reviewMessageSent: false,
      chatConfigured,
      tokenConfigured,
      realReviewEnabled: true,
      error: "unknown_error",
      message: "Telegram review dry-run failed."
    };
  }
}

function buildDryRunDraft(input: TelegramReviewDryRunInput): { text: string; replyMarkup: ReturnType<typeof buildTelegramReviewDraft>["reply_markup"] } {
  const draft = buildTelegramReviewDraft({
    itemId: "dry_run_item",
    caption: input.text,
    sourceUrl: input.sourceUrl ?? "manual-dry-run",
    status: "telegram_review_dry_run",
    links: input.sourceUrl === undefined ? [] : [input.sourceUrl]
  });

  return {
    text: draft.text,
    replyMarkup: draft.reply_markup
  };
}

function hasValue(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}
