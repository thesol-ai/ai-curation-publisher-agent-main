import type { ProviderErrorDetails } from "../provider-errors";
import type { ProviderHttpClient, ProviderHttpRequestOptions, ProviderHttpResult } from "./provider-http-client";

export type FetchProviderHttpClientOptions = {
  fetchImpl?: typeof fetch;
  defaultTimeoutMs?: number;
};

export class FetchProviderHttpClient implements ProviderHttpClient {
  private readonly fetchImpl: typeof fetch;
  private readonly defaultTimeoutMs: number;

  constructor(options: FetchProviderHttpClientOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 10_000;
  }

  async getJson<T>(url: string, options: ProviderHttpRequestOptions = {}): Promise<ProviderHttpResult<T>> {
    return this.requestJson<T>(url, { method: "GET", options });
  }

  async postJson<T>(url: string, body: unknown, options: ProviderHttpRequestOptions = {}): Promise<ProviderHttpResult<T>> {
    return this.requestJson<T>(url, {
      method: "POST",
      body,
      options
    });
  }

  private async requestJson<T>(url: string, input: {
    method: "GET" | "POST";
    body?: unknown;
    options: ProviderHttpRequestOptions;
  }): Promise<ProviderHttpResult<T>> {
    const timeoutMs = input.options.timeoutMs ?? this.defaultTimeoutMs;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await this.fetchImpl(url, {
        method: input.method,
        headers: {
          accept: "application/json",
          ...(input.body === undefined ? {} : { "content-type": "application/json" }),
          ...(input.options.headers ?? {})
        },
        ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
        signal: controller.signal
      });

      if (!response.ok) {
        return {
          ok: false,
          status: response.status,
          error: classifyHttpStatus(response.status, `Provider HTTP request failed with ${response.status}`)
        };
      }

      try {
        const data = await response.json() as T;
        return {
          ok: true,
          data,
          status: response.status
        };
      } catch (error) {
        return {
          ok: false,
          status: response.status,
          error: {
            category: "invalid_response",
            message: "Provider returned invalid JSON.",
            cause: error
          }
        };
      }
    } catch (error) {
      return {
        ok: false,
        error: classifyFetchFailure(error)
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}

function classifyHttpStatus(status: number, message: string): ProviderErrorDetails {
  if (status === 429) {
    return { category: "rate_limited", statusCode: status, message };
  }

  return { category: "http_error", statusCode: status, message };
}

function classifyFetchFailure(error: unknown): ProviderErrorDetails {
  if (error instanceof DOMException && error.name === "AbortError") {
    return {
      category: "timeout",
      message: "Provider HTTP request timed out.",
      cause: error
    };
  }

  if (error instanceof Error) {
    return {
      category: "network_error",
      message: error.message,
      cause: error
    };
  }

  return {
    category: "unknown_error",
    message: "Unknown provider HTTP failure.",
    cause: error
  };
}
