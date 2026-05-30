import { buildReviewInlineKeyboard, type TelegramReviewDraft } from "./index";

export type TelegramReviewAiOutput = {
  headline: string;
  rewrittenPersianCaption: string;
  shortSummary: string;
  language: string;
  riskFlags: string[];
  relevanceScore: number;
  suggestedHashtags: string[];
  sourceAttributionText: string;
};

export type BuildAiReviewMessageInput = {
  itemId: string;
  status: string;
  sourceUrl: string;
  aiOutput: TelegramReviewAiOutput;
  originalTextExcerpt?: string;
  provider?: string;
  platform?: string;
  sourceType?: string;
};

export function buildTelegramAiReviewDraft(input: BuildAiReviewMessageInput): TelegramReviewDraft {
  const riskFlags = input.aiOutput.riskFlags.length > 0 ? input.aiOutput.riskFlags.join(", ") : "none";
  const hashtags = input.aiOutput.suggestedHashtags.length > 0 ? input.aiOutput.suggestedHashtags.join(" ") : "none";
  const sourceMetadata = [input.provider, input.platform, input.sourceType].filter(Boolean).join(" / ") || "unknown";

  return {
    text: [
      "Telegram review draft",
      "",
      `Item: ${input.itemId}`,
      `Status: ${input.status}`,
      `Source: ${input.sourceUrl}`,
      `Source metadata: ${sourceMetadata}`,
      "",
      "Headline:",
      input.aiOutput.headline,
      "",
      "Persian caption:",
      input.aiOutput.rewrittenPersianCaption,
      "",
      "Summary:",
      input.aiOutput.shortSummary,
      "",
      `Language: ${input.aiOutput.language}`,
      `Risk flags: ${riskFlags}`,
      `Relevance score: ${input.aiOutput.relevanceScore}`,
      `Hashtags: ${hashtags}`,
      "",
      "Attribution:",
      input.aiOutput.sourceAttributionText,
      "",
      "Original excerpt:",
      input.originalTextExcerpt ?? "none"
    ].join("\n"),
    reply_markup: buildReviewInlineKeyboard(input.itemId)
  };
}

export function createOriginalTextExcerpt(value: string | undefined, maxLength = 240): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }

  if (trimmed.length <= maxLength) {
    return trimmed;
  }

  return `${trimmed.slice(0, maxLength - 1)}…`;
}
