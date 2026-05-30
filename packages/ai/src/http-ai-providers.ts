import type { AIProvider, AIProviderRequest, AIProviderResponse } from "./provider";

export type HttpAIProviderOptions = {
  apiKey?: string;
  model?: string;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
};

type ChatCompletionResponse = {
  model?: unknown;
  choices?: Array<{ message?: { content?: unknown } }>;
  usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
};

type GeminiResponse = {
  candidates?: Array<{ content?: { parts?: Array<{ text?: unknown }> } }>;
  usageMetadata?: { promptTokenCount?: unknown; candidatesTokenCount?: unknown };
};

export class OpenAIChatCompletionsProvider implements AIProvider {
  readonly id = "openai";
  private readonly apiKey: string | undefined;
  private readonly model: string | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;

  constructor(options: HttpAIProviderOptions = {}) {
    this.apiKey = options.apiKey?.trim();
    this.model = options.model;
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
    this.baseUrl = options.baseUrl ?? "https://api.openai.com/v1/chat/completions";
  }

  async generate(request: AIProviderRequest): Promise<AIProviderResponse> {
    if (!this.apiKey) throw new Error("OpenAI API key is not configured.");
    const model = this.model ?? request.model;
    const response = await this.fetchImpl(this.baseUrl, {
      method: "POST",
      headers: {
        "authorization": `Bearer ${this.apiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model,
        messages: request.messages,
        temperature: request.temperature,
        max_tokens: request.maxTokens,
        response_format: { type: "json_object" }
      })
    });
    const payload = await response.json().catch(() => null) as (ChatCompletionResponse & { error?: unknown }) | null;
    if (!response.ok || payload === null) {
      throw new Error(describeAIHttpError("OpenAI", response.status, payload));
    }
    const rawText = readString(payload.choices?.[0]?.message?.content);
    if (!rawText) throw new Error("OpenAI API response did not include message content.");
    const inputTokens = readNumber(payload.usage?.prompt_tokens);
    const outputTokens = readNumber(payload.usage?.completion_tokens);
    return {
      provider: this.id,
      model: readString(payload.model) ?? model,
      rawText,
      ...(inputTokens === undefined ? {} : { inputTokens }),
      ...(outputTokens === undefined ? {} : { outputTokens })
    };
  }
}


const GEMINI_TELEGRAM_OUTPUT_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    headline: { type: "STRING" },
    rewrittenPersianCaption: { type: "STRING" },
    shortSummary: { type: "STRING" },
    language: { type: "STRING" },
    riskFlags: {
      type: "ARRAY",
      items: { type: "STRING" }
    },
    relevanceScore: { type: "NUMBER" },
    suggestedHashtags: {
      type: "ARRAY",
      items: { type: "STRING" }
    },
    sourceAttributionText: { type: "STRING" }
  },
  required: [
    "headline",
    "rewrittenPersianCaption",
    "shortSummary",
    "language",
    "riskFlags",
    "relevanceScore",
    "suggestedHashtags",
    "sourceAttributionText"
  ],
  propertyOrdering: [
    "headline",
    "rewrittenPersianCaption",
    "shortSummary",
    "language",
    "riskFlags",
    "relevanceScore",
    "suggestedHashtags",
    "sourceAttributionText"
  ]
} as const;

export class GeminiGenerateContentProvider implements AIProvider {
  readonly id = "gemini";
  private readonly apiKey: string | undefined;
  private readonly model: string;
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;

  constructor(options: HttpAIProviderOptions = {}) {
    this.apiKey = options.apiKey?.trim();
    this.model = options.model ?? "gemini-2.5-flash";
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
    this.baseUrl = options.baseUrl ?? "https://generativelanguage.googleapis.com/v1beta/models";
  }

  async generate(request: AIProviderRequest): Promise<AIProviderResponse> {
    if (!this.apiKey) throw new Error("Gemini API key is not configured.");

    const primaryModel = this.model || request.model;
    const models = geminiModelCandidates(primaryModel);
    const system = request.messages.find((message) => message.role === "system")?.content ?? "";
    const user = request.messages.filter((message) => message.role === "user").map((message) => message.content).join("\n\n");

    let lastError: Error | undefined;

    for (const model of models) {
      const response = await this.fetchImpl(`${this.baseUrl}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(this.apiKey)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: "user", parts: [{ text: user }] }],
          generationConfig: {
            temperature: request.temperature,
            maxOutputTokens: request.maxTokens,
            responseMimeType: "application/json",
          responseSchema: GEMINI_TELEGRAM_OUTPUT_RESPONSE_SCHEMA
          }
        })
      });

      const payload = await response.json().catch(() => null) as (GeminiResponse & { error?: unknown }) | null;
      if (!response.ok || payload === null) {
        const error = new Error(describeAIHttpError("Gemini", response.status, payload));
        if (isRetryableGeminiError(response.status, error.message) && model !== models[models.length - 1]) {
          lastError = error;
          continue;
        }
        throw error;
      }

      const rawText = readString(payload.candidates?.[0]?.content?.parts?.[0]?.text);
      if (!rawText) {
        const error = new Error("Gemini API response did not include text content.");
        if (model !== models[models.length - 1]) {
          lastError = error;
          continue;
        }
        throw error;
      }

      const inputTokens = readNumber(payload.usageMetadata?.promptTokenCount);
      const outputTokens = readNumber(payload.usageMetadata?.candidatesTokenCount);
      return {
        provider: this.id,
        model,
        rawText,
        ...(inputTokens === undefined ? {} : { inputTokens }),
        ...(outputTokens === undefined ? {} : { outputTokens })
      };
    }

    throw lastError ?? new Error("Gemini API request failed.");
  }
}

export class CustomJsonAIProvider implements AIProvider {
  readonly id = "custom";
  private readonly delegate: OpenAIChatCompletionsProvider;

  constructor(options: HttpAIProviderOptions = {}) {
    this.delegate = new OpenAIChatCompletionsProvider(options);
  }

  async generate(request: AIProviderRequest): Promise<AIProviderResponse> {
    const response = await this.delegate.generate(request);
    return { ...response, provider: this.id };
  }
}


function geminiModelCandidates(primaryModel: string): string[] {
  const normalized = primaryModel.trim();
  const candidates = [normalized];

  if (normalized === "gemini-2.5-flash") {
    candidates.push("gemini-2.5-flash-lite");
  }

  return Array.from(new Set(candidates.filter((model) => model.length > 0)));
}

function isRetryableGeminiError(status: number, message: string): boolean {
  if ([429, 500, 502, 503, 504].includes(status)) return true;
  return /UNAVAILABLE|high demand|temporarily|temporary|overloaded|rate limit|rate-limited|timeout/i.test(message);
}

function describeAIHttpError(provider: string, status: number, payload: unknown): string {
  const detail = extractAIErrorDetail(payload);
  return detail.length > 0
    ? `${provider} API request failed with HTTP ${status}: ${detail}`
    : `${provider} API request failed with HTTP ${status}.`;
}

function extractAIErrorDetail(payload: unknown): string {
  if (!isRecord(payload)) return "";

  const error = payload.error;
  if (isRecord(error)) {
    const message = typeof error.message === "string" ? error.message : "";
    const status = typeof error.status === "string" ? error.status : "";
    const code = typeof error.code === "number" || typeof error.code === "string" ? String(error.code) : "";

    return [status, code, message]
      .filter((part) => part.trim().length > 0)
      .join(" | ")
      .slice(0, 500);
  }

  const message = typeof payload.message === "string" ? payload.message : "";
  return message.slice(0, 500);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
