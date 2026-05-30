import type { NormalizedPost } from "./item";
import type { Platform } from "./platform";
import type { FetchSourceInput } from "./source";

export type ProviderCapabilities = {
  supportsProfiles: boolean;
  supportsHashtags: boolean;
  supportsQueries: boolean;
  supportsDirectUrls: boolean;
  supportsWebUrls: boolean;
  supportsMediaMetadata: boolean;
};

export type ProviderFetchResult = {
  provider: string;
  items: NormalizedPost[];
  nextCursor?: string;
  fetchedAt: string;
};

export type ProviderHealthResult = {
  provider: string;
  ok: boolean;
  checkedAt: string;
  message?: string;
};

export interface SocialProvider {
  id: string;
  platform: Platform;
  capabilities: ProviderCapabilities;
  fetchSource(input: FetchSourceInput): Promise<ProviderFetchResult>;
  fetchDirectUrl?(url: string): Promise<ProviderFetchResult>;
  healthCheck(): Promise<ProviderHealthResult>;
}
