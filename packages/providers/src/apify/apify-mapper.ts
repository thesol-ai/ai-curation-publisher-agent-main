import type { NormalizedPost } from "@curator/core";

export type ProviderMappingResult = {
  posts: NormalizedPost[];
  warnings: string[];
  errors: string[];
};

type ApifyRecord = {
  id?: unknown;
  shortcode?: unknown;
  url?: unknown;
  caption?: unknown;
  timestamp?: unknown;
  ownerUsername?: unknown;
  displayUrl?: unknown;
  images?: unknown;
  videoUrl?: unknown;
};

export function mapApifyInstagramResponseToPosts(input: unknown, providerId = "apify_instagram"): ProviderMappingResult {
  const records = extractRecords(input);
  const warnings: string[] = [];
  const errors: string[] = [];
  const posts: NormalizedPost[] = [];

  if (!records) {
    return {
      posts: [],
      warnings: [],
      errors: ["Apify Instagram response must be an array or an object with an items array."]
    };
  }

  records.forEach((record, index) => {
    if (!isObject(record)) {
      warnings.push(`Skipped Apify record ${index}: record is not an object.`);
      return;
    }

    const candidate = record as ApifyRecord;
    const canonicalUrl = asString(candidate.url);
    const sourcePostId = asString(candidate.id) ?? asString(candidate.shortcode) ?? canonicalUrl;
    const text = asString(candidate.caption);
    const publishedAt = asString(candidate.timestamp);
    const authorHandle = asString(candidate.ownerUsername);

    if (!sourcePostId || !canonicalUrl) {
      warnings.push(`Skipped Apify record ${index}: missing source post id or URL.`);
      return;
    }

    posts.push({
      provider: providerId,
      platform: "instagram",
      sourceType: "direct_url",
      sourcePostId,
      canonicalUrl,
      ...(publishedAt === undefined ? {} : { publishedAt }),
      ...(authorHandle === undefined ? {} : { authorHandle }),
      ...(text === undefined ? {} : { text }),
      links: [canonicalUrl],
      media: collectMedia(candidate),
      rawPayload: record
    });
  });

  return { posts, warnings, errors };
}

function extractRecords(input: unknown): unknown[] | null {
  if (Array.isArray(input)) {
    return input;
  }

  if (isObject(input) && Array.isArray((input as { items?: unknown }).items)) {
    return (input as { items: unknown[] }).items;
  }

  return null;
}

function collectMedia(record: ApifyRecord): NormalizedPost["media"] {
  const media: NormalizedPost["media"] = [];
  const displayUrl = asString(record.displayUrl);
  if (displayUrl) {
    media.push({ kind: "image", sourceUrl: displayUrl, canonicalUrl: displayUrl });
  }

  if (Array.isArray(record.images)) {
    for (const image of record.images) {
      const sourceUrl = asString(image);
      if (sourceUrl) {
        media.push({ kind: "image", sourceUrl, canonicalUrl: sourceUrl });
      }
    }
  }

  const videoUrl = asString(record.videoUrl);
  if (videoUrl) {
    media.push({ kind: "video", sourceUrl: videoUrl, canonicalUrl: videoUrl });
  }

  return media;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
