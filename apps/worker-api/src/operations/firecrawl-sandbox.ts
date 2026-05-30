import { FirecrawlWebProvider, FetchProviderHttpClient, classifyProviderError, createProviderAvailability, readProviderRuntimeConfig, type ProviderHttpClient } from "@curator/providers";
import type { NormalizedPost } from "@curator/core";
import type { Env } from "../types";

export type FirecrawlSandboxFetchInput = {
  url: string;
  limit?: number;
};

export type FirecrawlSandboxFetchResult = {
  ok: boolean;
  inspectOnly: true;
  providerId: "firecrawl";
  enabled: boolean;
  configured: boolean;
  status: string;
  posts: NormalizedPost[];
  normalizedCount: number;
  error?: string;
  message?: string;
};

export type FirecrawlSandboxOptions = {
  env: Env;
  input: FirecrawlSandboxFetchInput;
  httpClient?: ProviderHttpClient;
  now?: () => Date;
};

export async function runFirecrawlSandboxFetch(options: FirecrawlSandboxOptions): Promise<FirecrawlSandboxFetchResult> {
  const config = readProviderRuntimeConfig(options.env);
  const firecrawlConfig = config.realProviders.firecrawlWeb;
  const availability = createProviderAvailability({
    providerId: firecrawlConfig.providerId,
    platform: firecrawlConfig.platform,
    enabled: firecrawlConfig.enabled,
    credentialConfigured: firecrawlConfig.credentialConfigured,
    missingCredentialName: firecrawlConfig.credentialEnvName
  });

  if (!availability.enabled) {
    return {
      ok: false,
      inspectOnly: true,
      providerId: "firecrawl",
      enabled: availability.enabled,
      configured: availability.credentialConfigured,
      status: availability.status,
      posts: [],
      normalizedCount: 0,
      error: availability.status,
      message: availability.message
    };
  }

  const providerOptions = {
    availability,
    baseUrl: firecrawlConfig.baseUrl,
    timeoutMs: firecrawlConfig.timeoutMs,
    httpClient: options.httpClient ?? new FetchProviderHttpClient({ defaultTimeoutMs: firecrawlConfig.timeoutMs }),
    ...(options.env.FIRECRAWL_API_KEY === undefined ? {} : { apiKey: options.env.FIRECRAWL_API_KEY }),
    ...(options.now === undefined ? {} : { now: options.now })
  };

  const provider = new FirecrawlWebProvider(providerOptions);

  try {
    const result = await provider.fetchByDirectUrl(options.input.url, { limit: options.input.limit ?? 1 });

    return {
      ok: true,
      inspectOnly: true,
      providerId: "firecrawl",
      enabled: availability.enabled,
      configured: availability.credentialConfigured,
      status: availability.status,
      posts: result.posts,
      normalizedCount: result.posts.length
    };
  } catch (error) {
    const providerError = classifyProviderError(error);

    return {
      ok: false,
      inspectOnly: true,
      providerId: "firecrawl",
      enabled: availability.enabled,
      configured: availability.credentialConfigured,
      status: providerError.category,
      posts: [],
      normalizedCount: 0,
      error: providerError.category,
      message: providerError.message
    };
  }
}
