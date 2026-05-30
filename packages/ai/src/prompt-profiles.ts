import type { NormalizedPost, OutputTarget } from "@curator/core";
import { TELEGRAM_OUTPUT_SCHEMA_REF } from "./telegram-output";
import type { PromptDefinition } from "./prompts";

export type TelegramPromptProfileKey = "default_editorial" | "crypto_editorial" | "design_editorial" | "marketing_editorial" | "product_editorial" | string;

export type LocalizedTelegramPromptInput = {
  post: NormalizedPost;
  category: string;
  language: string;
  promptProfile: TelegramPromptProfileKey;
  sourceAttributionText: string;
  model: string;
  temperature: number;
  maxTokens: number;
  customSystemPrompt?: string;
};

type ProfileDefinition = {
  promptId: string;
  target: OutputTarget;
  editorialGuidance: string;
};

const PROFILE_DEFINITIONS: Record<string, ProfileDefinition> = {
  default_editorial: {
    promptId: "telegram_default_editorial_v1",
    target: "telegram",
    editorialGuidance: "Rewrite the source as a clear, accurate Telegram post for the configured audience. Preserve facts, avoid unsupported claims, and keep source attribution."
  },
  crypto_editorial: {
    promptId: "telegram_crypto_editorial_v1",
    target: "telegram",
    editorialGuidance: "Write for a crypto audience. Explain market, protocol, token, security, and risk context cautiously. Do not provide financial advice or invent price claims."
  },
  design_editorial: {
    promptId: "telegram_design_editorial_v1",
    target: "telegram",
    editorialGuidance: "Write for designers and product teams. Emphasize UX implications, patterns, trade-offs, and practical takeaways."
  },
  marketing_editorial: {
    promptId: "telegram_marketing_editorial_v1",
    target: "telegram",
    editorialGuidance: "Write for marketing and growth teams. Emphasize positioning, channels, campaign implications, and measurable takeaways."
  },
  product_editorial: {
    promptId: "telegram_product_editorial_v1",
    target: "telegram",
    editorialGuidance: "Write for product teams. Emphasize user impact, adoption, risks, roadmap implications, and operational decisions."
  }
};

export function buildLocalizedTelegramPrompt(input: LocalizedTelegramPromptInput): PromptDefinition {
  const profile = PROFILE_DEFINITIONS[input.promptProfile] ?? PROFILE_DEFINITIONS.default_editorial!;
  const customSystemPrompt = input.customSystemPrompt?.trim();
  const languageName = languageInstruction(input.language);
  return {
    promptId: profile.promptId,
    promptVersion: "2.0.0",
    target: profile.target,
    systemPrompt: [
      "You are an editorial automation assistant for Telegram publishing.",
      profile.editorialGuidance,
      `Produce the final post in ${languageName}.`,
      "Return only JSON matching this exact shape: {\"headline\":string,\"rewrittenPersianCaption\":string,\"shortSummary\":string,\"language\":string,\"riskFlags\":string[],\"relevanceScore\":number,\"suggestedHashtags\":string[],\"sourceAttributionText\":string}.",
      "The field rewrittenPersianCaption is legacy-named; fill it with the final caption in the requested language, even when the language is not Persian.",
      "Do not add facts, numbers, quotes, prices, claims, or media details that are not present in the source input.",
      customSystemPrompt && customSystemPrompt.length > 0 ? `Custom operator instruction: ${customSystemPrompt}` : ""
    ].filter(Boolean).join("\n"),
    userPromptTemplate: [
      "Category: {{category}}",
      "Output language: {{language}}",
      "Source URL: {{canonicalUrl}}",
      "Author: {{authorHandle}}",
      "Original text or caption:",
      "{{text}}",
      "Links:",
      "{{links}}",
      "Media count: {{mediaCount}}",
      "Source attribution:",
      "{{sourceAttributionText}}",
      "Task:",
      "1. Rewrite or translate the content into the requested output language.",
      "2. Keep the caption Telegram-ready.",
      "3. Include a concise headline, summary, hashtags, and risk flags.",
      "4. Keep attribution intact."
    ].join("\n"),
    model: input.model,
    temperature: input.temperature,
    maxTokens: input.maxTokens,
    outputSchemaRef: TELEGRAM_OUTPUT_SCHEMA_REF
  };
}

export function renderLocalizedTemplateValues(input: LocalizedTelegramPromptInput): Record<string, string> {
  return {
    category: input.category,
    language: input.language,
    canonicalUrl: input.post.canonicalUrl,
    authorHandle: input.post.authorHandle ?? "unknown",
    text: input.post.text ?? "",
    links: input.post.links.length > 0 ? input.post.links.join("\n") : "none",
    mediaCount: String(input.post.media.length),
    sourceAttributionText: input.sourceAttributionText
  };
}

function languageInstruction(language: string): string {
  if (language === "fa") return "Persian/Farsi";
  if (language === "ar") return "Arabic";
  if (language === "en") return "English";
  return language;
}
