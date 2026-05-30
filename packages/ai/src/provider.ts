import type { OutputTarget } from "@curator/core";

export type AIMessageRole = "system" | "user";

export type AIMessage = {
  role: AIMessageRole;
  content: string;
};

export type AIProviderRequest = {
  promptId: string;
  promptVersion: string;
  target: OutputTarget;
  model: string;
  messages: AIMessage[];
  temperature: number;
  maxTokens: number;
  outputSchemaRef: string;
};

export type AIProviderResponse = {
  provider: string;
  model: string;
  rawText: string;
  output?: unknown;
  inputTokens?: number;
  outputTokens?: number;
};

export interface AIProvider {
  readonly id: string;
  generate(request: AIProviderRequest): Promise<AIProviderResponse>;
}

export class HTTPAIProviderStub implements AIProvider {
  readonly id = "http_ai_provider_stub";

  async generate(): Promise<AIProviderResponse> {
    throw new Error("HTTPAIProviderStub is disabled in Phase 4. Use MockAIProvider for tests and local development.");
  }
}
