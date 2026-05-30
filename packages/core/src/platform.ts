export const PLATFORMS = ["instagram", "x", "web", "manual"] as const;
export type Platform = typeof PLATFORMS[number];

export const SOURCE_TYPES = ["profile", "hashtag", "query", "direct_url", "web_url", "manual"] as const;
export type SourceType = typeof SOURCE_TYPES[number];

export const PROVIDER_IDS = [
  "mock_social_provider",
  "apify_instagram",
  "hikerapi",
  "rapidapi_instagram",
  "getxapi",
  "apify_x",
  "socialcrawl",
  "firecrawl",
  "simple_extractor"
] as const;
export type ProviderId = typeof PROVIDER_IDS[number] | (string & {});
