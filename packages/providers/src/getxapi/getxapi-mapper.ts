import type { NormalizedPost } from "@curator/core";

export type GetXApiMappingResult = {
  posts: NormalizedPost[];
  warnings: string[];
  errors: string[];
};

type GetXApiRecord = {
  id?: unknown;
  tweet_id?: unknown;
  url?: unknown;
  text?: unknown;
  full_text?: unknown;
  created_at?: unknown;
  author?: unknown;
  user?: unknown;
  media?: unknown;
};

export function mapGetXApiResponseToPosts(input: unknown, providerId = "getxapi"): GetXApiMappingResult {
  const records = extractRecords(input);
  const warnings: string[] = [];
  const errors: string[] = [];
  const posts: NormalizedPost[] = [];

  if (!records) {
    return {
      posts: [],
      warnings: [],
      errors: ["GetXAPI response must be an array or an object with tweets, data, or items array."]
    };
  }

  records.forEach((record, index) => {
    if (!isObject(record)) {
      warnings.push(`Skipped GetXAPI record ${index}: record is not an object.`);
      return;
    }

    const candidate = record as GetXApiRecord;
    const sourcePostId = asString(candidate.id) ?? asString(candidate.tweet_id);
    const canonicalUrl = asString(candidate.url) ?? (sourcePostId === undefined ? undefined : `https://x.com/i/web/status/${sourcePostId}`);
    const text = asString(candidate.text) ?? asString(candidate.full_text);
    const publishedAt = asString(candidate.created_at);
    const authorHandle = extractAuthor(candidate);

    if (!sourcePostId || !canonicalUrl) {
      warnings.push(`Skipped GetXAPI record ${index}: missing tweet id or URL.`);
      return;
    }

    const post: NormalizedPost = {
      provider: providerId,
      platform: "x",
      sourceType: "direct_url",
      sourcePostId,
      canonicalUrl,
      links: [canonicalUrl],
      media: collectMedia(candidate.media),
      rawPayload: record
    };

    if (publishedAt !== undefined) {
      post.publishedAt = publishedAt;
    }

    if (authorHandle !== undefined) {
      post.authorHandle = authorHandle;
    }

    if (text !== undefined) {
      post.text = text;
    }

    posts.push(post);
  });

  return { posts, warnings, errors };
}

function extractRecords(input: unknown): unknown[] | null {
  if (Array.isArray(input)) {
    return input;
  }

  if (!isObject(input)) {
    return null;
  }

  const candidate = input as { tweets?: unknown; data?: unknown; items?: unknown };
  if (Array.isArray(candidate.tweets)) {
    return candidate.tweets;
  }

  if (Array.isArray(candidate.data)) {
    return candidate.data;
  }

  if (Array.isArray(candidate.items)) {
    return candidate.items;
  }

  return null;
}

function extractAuthor(record: GetXApiRecord): string | undefined {
  if (isObject(record.author)) {
    return asString((record.author as { username?: unknown; screen_name?: unknown }).username)
      ?? asString((record.author as { username?: unknown; screen_name?: unknown }).screen_name);
  }

  if (isObject(record.user)) {
    return asString((record.user as { username?: unknown; screen_name?: unknown }).username)
      ?? asString((record.user as { username?: unknown; screen_name?: unknown }).screen_name);
  }

  return undefined;
}

function collectMedia(input: unknown): NormalizedPost["media"] {
  if (!Array.isArray(input)) {
    return [];
  }

  const media: NormalizedPost["media"] = [];
  for (const item of input) {
    if (typeof item === "string") {
      media.push({ kind: inferKind(item), sourceUrl: item, canonicalUrl: item });
      continue;
    }

    if (isObject(item)) {
      const sourceUrl = asString((item as { url?: unknown; media_url?: unknown }).url)
        ?? asString((item as { url?: unknown; media_url?: unknown }).media_url);
      if (sourceUrl) {
        media.push({ kind: inferKind(sourceUrl), sourceUrl, canonicalUrl: sourceUrl });
      }
    }
  }

  return media;
}

function inferKind(url: string): "image" | "video" {
  return /\.(mp4|mov|webm)(\?|$)/i.test(url) ? "video" : "image";
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
