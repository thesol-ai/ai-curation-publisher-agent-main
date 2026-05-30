import type { NormalizedPost, Platform, Source, SourceType } from "@curator/core";
import type { ProviderAdapter, ProviderFetchOptions, ProviderFetchResponse } from "../provider-adapter";
import { applyProviderLimit, assertSourceTypeSupported } from "../provider-adapter";

export type MockProviderScenario = "normal" | "duplicates" | "empty" | "failure";

export type MockProviderOptions = {
  id?: string;
  scenario?: MockProviderScenario;
  now?: () => Date;
};

export function createMockPost(input: {
  providerId: string;
  platform: Platform;
  sourceType: SourceType;
  sourceValue: string;
  index: number;
  canonicalUrl?: string;
  text?: string;
}): NormalizedPost {
  const sourceSlug = slugify(input.sourceValue);
  const sourcePostId = `${input.platform}_${input.sourceType}_${sourceSlug}_${input.index}`;
  return {
    provider: input.providerId,
    platform: input.platform,
    sourceType: input.sourceType,
    sourcePostId,
    canonicalUrl: input.canonicalUrl ?? `https://example.com/${input.platform}/${input.sourceType}/${sourceSlug}/${input.index}`,
    publishedAt: `2025-01-0${Math.min(input.index + 1, 9)}T00:00:00.000Z`,
    authorHandle: `${input.platform}_${sourceSlug}`,
    text: input.text ?? `Mock ${input.platform} ${input.sourceType} post ${input.index} for ${input.sourceValue}`,
    links: [`https://example.com/${input.platform}/${sourceSlug}`],
    media: [
      {
        kind: "image",
        sourceUrl: `https://example.com/media/${input.platform}-${sourceSlug}-${input.index}.jpg`,
        canonicalUrl: `https://example.com/media/${input.platform}-${sourceSlug}-${input.index}.jpg`,
        mimeType: "image/jpeg",
        width: 1200,
        height: 630,
        altText: `Mock ${input.platform} image`
      }
    ],
    rawPayload: {
      mocked: true,
      provider: input.providerId,
      sourceValue: input.sourceValue,
      index: input.index
    }
  };
}

export async function fetchMockRecentPosts(input: {
  provider: ProviderAdapter;
  source: Source;
  supportedSourceTypes: readonly SourceType[];
  scenario: MockProviderScenario;
  now: () => Date;
  limit?: number | undefined;
  backfillLimit?: number | undefined;
}): Promise<ProviderFetchResponse> {
  assertSourceTypeSupported(input.provider, input.source.sourceType);

  if (input.scenario === "failure") {
    throw new Error(`${input.provider.id} mock provider failure`);
  }

  const posts = input.scenario === "empty" ? [] : createScenarioPosts(input.provider.id, input.source, input.scenario);
  const limitOptions: ProviderFetchOptions = {
    ...(input.limit === undefined ? {} : { limit: input.limit }),
    ...(input.backfillLimit === undefined ? {} : { backfillLimit: input.backfillLimit })
  };

  return {
    providerId: input.provider.id,
    platform: input.provider.platform,
    sourceType: input.source.sourceType,
    posts: applyProviderLimit(posts, limitOptions),
    fetchedAt: input.now().toISOString(),
    ...(posts.length === 0 ? {} : { nextCursor: `${input.provider.id}-cursor-001` })
  };
}

export async function fetchMockDirectUrl(input: {
  provider: ProviderAdapter;
  url: string;
  sourceType: SourceType;
  scenario: MockProviderScenario;
  now: () => Date;
}): Promise<ProviderFetchResponse> {
  if (input.scenario === "failure") {
    throw new Error(`${input.provider.id} mock provider failure`);
  }

  const posts = input.scenario === "empty" ? [] : [
    createMockPost({
      providerId: input.provider.id,
      platform: input.provider.platform,
      sourceType: input.sourceType,
      sourceValue: input.url,
      index: 1,
      canonicalUrl: input.url,
      text: `Mock direct URL post for ${input.url}`
    })
  ];

  return {
    providerId: input.provider.id,
    platform: input.provider.platform,
    sourceType: input.sourceType,
    posts,
    fetchedAt: input.now().toISOString()
  };
}

function createScenarioPosts(providerId: string, source: Source, scenario: MockProviderScenario): NormalizedPost[] {
  const first = createMockPost({ providerId, platform: source.platform, sourceType: source.sourceType, sourceValue: source.value, index: 1 });
  const firstRawPayload = typeof first.rawPayload === "object" && first.rawPayload !== null ? first.rawPayload : {};
  const second = scenario === "duplicates"
    ? { ...first, rawPayload: { ...firstRawPayload, duplicate: true } }
    : createMockPost({ providerId, platform: source.platform, sourceType: source.sourceType, sourceValue: source.value, index: 2 });

  return [first, second];
}

function slugify(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "source";
}
