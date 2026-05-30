import type { AIProvider, AIProviderRequest, AIProviderResponse } from "./provider";
import type { TelegramStructuredOutput } from "./telegram-output";

export class MockAIProvider implements AIProvider {
  readonly id = "mock_ai_provider";

  constructor(private readonly output: TelegramStructuredOutput = createDefaultMockTelegramOutput()) {}

  async generate(request: AIProviderRequest): Promise<AIProviderResponse> {
    const rawText = JSON.stringify(this.output);

    return {
      provider: this.id,
      model: request.model,
      rawText,
      output: this.output,
      inputTokens: estimateTokens(request.messages.map((message) => message.content).join("\n")),
      outputTokens: estimateTokens(rawText)
    };
  }
}

export function createDefaultMockTelegramOutput(): TelegramStructuredOutput {
  return {
    headline: "خلاصه کوتاه برای تلگرام",
    rewrittenPersianCaption: "این یک کپشن بازنویسی‌شده برای بررسی انسانی در تلگرام است.",
    shortSummary: "خلاصه‌ای کوتاه از محتوای ورودی برای استفاده در جریان بررسی.",
    language: "fa",
    riskFlags: [],
    relevanceScore: 0.82,
    suggestedHashtags: ["#AI", "#Tech"],
    sourceAttributionText: "منبع: لینک اصلی محتوا"
  };
}

function estimateTokens(value: string): number {
  return Math.max(1, Math.ceil(value.length / 4));
}
