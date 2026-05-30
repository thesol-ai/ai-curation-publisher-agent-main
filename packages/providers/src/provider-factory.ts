import type { ProviderAdapter } from "./provider-adapter";
import { providerAvailabilityList, readProviderRuntimeConfig, summarizeProviderConfig, type ProviderConfigSummary, type ProviderRuntimeConfig, type ProviderRuntimeEnv } from "./config/provider-config";
import { ApifyInstagramProvider } from "./apify/apify-instagram-provider";
import { FirecrawlWebProvider } from "./firecrawl/firecrawl-web-provider";
import { GetXapiXProvider } from "./getxapi/getxapi-x-provider";
import type { ProviderHttpClient } from "./http/provider-http-client";
import { MockInstagramProvider } from "./mock/mock-instagram-provider";
import { MockWebProvider } from "./mock/mock-web-provider";
import { MockXProvider } from "./mock/mock-x-provider";
import type { ProviderAvailability } from "./provider-status";

export type ProviderFactoryOptions = {
  env?: ProviderRuntimeEnv;
  config?: ProviderRuntimeConfig;
  httpClient?: ProviderHttpClient;
  now?: () => Date;
};

export type ProviderFactoryResult = {
  providers: ProviderAdapter[];
  availability: ProviderAvailability[];
  summary: ProviderConfigSummary;
};

export function createProvidersFromConfig(options: ProviderFactoryOptions = {}): ProviderFactoryResult {
  const env = options.env ?? {};
  const config = options.config ?? readProviderRuntimeConfig(env);
  const availability = providerAvailabilityList(config);
  const providers: ProviderAdapter[] = [];
  const timingOptions = options.now === undefined ? {} : { now: options.now };
  const realProviderOptions = options.httpClient === undefined
    ? timingOptions
    : { ...timingOptions, httpClient: options.httpClient };

  if (config.mockProvidersEnabled) {
    providers.push(
      new MockInstagramProvider(timingOptions),
      new MockXProvider(timingOptions),
      new MockWebProvider(timingOptions)
    );
  }

  const byId = new Map(availability.map((entry) => [entry.providerId, entry]));

  if (config.mode !== "mock") {
    const apify = byId.get("apify_instagram");
    const getxapi = byId.get("getxapi");
    const firecrawl = byId.get("firecrawl");

    if (apify && config.realProviders.apifyInstagram.enabled) {
      providers.push(new ApifyInstagramProvider({
        availability: apify,
        ...realProviderOptions,
        ...(env.APIFY_TOKEN === undefined ? {} : { apiKey: env.APIFY_TOKEN })
      }));
    }

    if (getxapi && config.realProviders.getxapiX.enabled) {
      providers.push(new GetXapiXProvider({
        availability: getxapi,
        ...realProviderOptions,
        ...(env.GETXAPI_KEY === undefined ? {} : { apiKey: env.GETXAPI_KEY })
      }));
    }

    if (firecrawl && config.realProviders.firecrawlWeb.enabled) {
      providers.push(new FirecrawlWebProvider({
        availability: firecrawl,
        baseUrl: config.realProviders.firecrawlWeb.baseUrl,
        timeoutMs: config.realProviders.firecrawlWeb.timeoutMs,
        ...realProviderOptions,
        ...(env.FIRECRAWL_API_KEY === undefined ? {} : { apiKey: env.FIRECRAWL_API_KEY })
      }));
    }
  }

  return {
    providers,
    availability,
    summary: summarizeProviderConfig(config)
  };
}
