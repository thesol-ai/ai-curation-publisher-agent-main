import type { NormalizedPost, OutputTarget } from "@curator/core";
import { TELEGRAM_OUTPUT_SCHEMA_REF } from "./telegram-output";

export type PromptDefinition = {
  promptId: string;
  promptVersion: string;
  target: OutputTarget;
  systemPrompt: string;
  userPromptTemplate: string;
  model: string;
  temperature: number;
  maxTokens: number;
  outputSchemaRef: string;
  negativePrompt?: string;
};

export type RenderPromptInput = {
  post: NormalizedPost;
  sourceAttributionText?: string;
  templateValues?: Record<string, string>;
};

export type RenderedPrompt = PromptDefinition & {
  systemMessage: string;
  userMessage: string;
};

export const DEFAULT_TELEGRAM_PROMPT: PromptDefinition = {
  promptId: "telegram_curation_v1",
  promptVersion: "1.0.0",
  target: "telegram",
  systemPrompt: [
    "You rewrite curated social posts for a Persian Telegram audience.",
    "Return only structured JSON matching the requested schema.",
    "Do not invent source details or publish claims that are not present in the input."
  ].join("\n"),
  userPromptTemplate: [
    "Source URL: {{canonicalUrl}}",
    "Author: {{authorHandle}}",
    "Original text:",
    "{{text}}",
    "Links:",
    "{{links}}",
    "Source attribution:",
    "{{sourceAttributionText}}"
  ].join("\n"),
  model: "mock-telegram-curator-v1",
  temperature: 0.2,
  maxTokens: 700,
  outputSchemaRef: TELEGRAM_OUTPUT_SCHEMA_REF
};

export function renderTelegramPrompt(input: RenderPromptInput, prompt: PromptDefinition = DEFAULT_TELEGRAM_PROMPT): RenderedPrompt {
  const values: Record<string, string> = {
    canonicalUrl: input.post.canonicalUrl,
    authorHandle: input.post.authorHandle ?? "unknown",
    text: input.post.text ?? "",
    links: input.post.links.length > 0 ? input.post.links.join("\n") : "none",
    sourceAttributionText: input.sourceAttributionText ?? `Source: ${input.post.canonicalUrl}`,
    ...(input.templateValues ?? {})
  };

  return {
    ...prompt,
    systemMessage: prompt.negativePrompt && prompt.negativePrompt.trim().length > 0 ? `${prompt.systemPrompt}

Negative instructions:
${prompt.negativePrompt}` : prompt.systemPrompt,
    userMessage: renderTemplate(prompt.userPromptTemplate, values)
  };
}

export function renderTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/{{([a-zA-Z0-9_]+)}}/g, (_match, key: string) => values[key] ?? "");
}
