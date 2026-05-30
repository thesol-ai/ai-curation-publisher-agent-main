import type { ProviderErrorDetails } from "../provider-errors";
import type { ProviderHttpClient, ProviderHttpRequestOptions, ProviderHttpResult } from "./provider-http-client";

export type MockProviderHttpClientResponse = {
  method: "GET" | "POST";
  url: string;
  response: unknown;
  status?: number;
};

export type MockProviderHttpClientFailure = {
  method: "GET" | "POST";
  url: string;
  error: ProviderErrorDetails;
  status?: number;
};

export class MockProviderHttpClient implements ProviderHttpClient {
  readonly requests: Array<{ method: "GET" | "POST"; url: string; body?: unknown; options?: ProviderHttpRequestOptions }> = [];

  constructor(
    private readonly responses: MockProviderHttpClientResponse[] = [],
    private readonly failures: MockProviderHttpClientFailure[] = []
  ) {}

  async getJson<T>(url: string, options?: ProviderHttpRequestOptions): Promise<ProviderHttpResult<T>> {
    this.requests.push({ method: "GET", url, ...(options === undefined ? {} : { options }) });
    return this.findResult<T>("GET", url);
  }

  async postJson<T>(url: string, body: unknown, options?: ProviderHttpRequestOptions): Promise<ProviderHttpResult<T>> {
    this.requests.push({ method: "POST", url, body, ...(options === undefined ? {} : { options }) });
    return this.findResult<T>("POST", url);
  }

  private findResult<T>(method: "GET" | "POST", url: string): ProviderHttpResult<T> {
    const failure = this.failures.find((candidate) => candidate.method === method && candidate.url === url);
    if (failure) {
      return {
        ok: false,
        error: failure.error,
        ...(failure.status === undefined ? {} : { status: failure.status })
      };
    }

    const response = this.responses.find((candidate) => candidate.method === method && candidate.url === url);
    if (!response) {
      return {
        ok: false,
        error: {
          category: "provider_error",
          message: `No mock provider HTTP response configured for ${method} ${url}`
        }
      };
    }

    return {
      ok: true,
      data: response.response as T,
      status: response.status ?? 200
    };
  }
}
