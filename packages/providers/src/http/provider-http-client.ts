import type { ProviderErrorDetails } from "../provider-errors";

export type ProviderHttpRequestOptions = {
  headers?: Record<string, string>;
  timeoutMs?: number;
};

export type ProviderHttpSuccess<T> = {
  ok: true;
  data: T;
  status: number;
};

export type ProviderHttpFailure = {
  ok: false;
  error: ProviderErrorDetails;
  status?: number;
};

export type ProviderHttpResult<T> = ProviderHttpSuccess<T> | ProviderHttpFailure;

export interface ProviderHttpClient {
  getJson<T>(url: string, options?: ProviderHttpRequestOptions): Promise<ProviderHttpResult<T>>;
  postJson<T>(url: string, body: unknown, options?: ProviderHttpRequestOptions): Promise<ProviderHttpResult<T>>;
}
