import type { NormalizedPost } from "@curator/core";

export type FirecrawlMappingResult = {
  posts: NormalizedPost[];
  warnings: string[];
  errors: string[];
};

type FirecrawlRecord = {
  url?: unknown;
  sourceUrl?: unknown;
  title?: unknown;
  markdown?: unknown;
  content?: unknown;
  excerpt?: unknown;
  description?: unknown;
  author?: unknown;
  publishedAt?: unknown;
  metadata?: unknown;
};

export function mapFirecrawlResponseToPosts(input: unknown, providerId = "firecrawl"): FirecrawlMappingResult {
  const records = extractRecords(input);
  const warnings: string[] = [];
  const errors: string[] = [];
  const posts: NormalizedPost[] = [];

  if (!records) {
    return {
      posts: [],
      warnings: [],
      errors: ["Firecrawl response must be an object with data, items, or a single article URL."]
    };
  }

  records.forEach((record, index) => {
    if (!isObject(record)) {
      warnings.push(`Skipped Firecrawl record ${index}: record is not an object.`);
      return;
    }

    const candidate = record as FirecrawlRecord;
    const canonicalUrl = asString(candidate.url) ?? asString(candidate.sourceUrl) ?? extractMetadataString(candidate.metadata, "sourceURL");
    const title = asString(candidate.title) ?? extractMetadataString(candidate.metadata, "title");
    const content = asString(candidate.markdown) ?? asString(candidate.content) ?? asString(candidate.excerpt) ?? asString(candidate.description);
    const publishedAt = extractPublishedAt(candidate);
    const authorHandle = extractAuthor(candidate);
    const text = content === undefined ? undefined : title === undefined ? content : `${title}\n\n${content}`;

    if (!canonicalUrl) {
      warnings.push(`Skipped Firecrawl record ${index}: missing URL.`);
      return;
    }

    const post: NormalizedPost = {
      provider: providerId,
      platform: "web",
      sourceType: "web_url",
      sourcePostId: canonicalUrl,
      canonicalUrl,
      links: [canonicalUrl],
      media: [],
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

  const candidate = input as { data?: unknown; items?: unknown };
  if (Array.isArray(candidate.data)) {
    return candidate.data;
  }

  if (Array.isArray(candidate.items)) {
    return candidate.items;
  }

  if (isObject(candidate.data)) {
    return [candidate.data];
  }

  if (asString((input as FirecrawlRecord).url) || asString((input as FirecrawlRecord).sourceUrl)) {
    return [input];
  }

  return null;
}

function extractAuthor(record: FirecrawlRecord): string | undefined {
  return asString(record.author) ?? extractMetadataString(record.metadata, "author");
}

function extractPublishedAt(record: FirecrawlRecord): string | undefined {
  return asString(record.publishedAt) ?? extractMetadataString(record.metadata, "publishedTime") ?? extractMetadataString(record.metadata, "date");
}

function extractMetadataString(metadata: unknown, key: string): string | undefined {
  if (!isObject(metadata)) {
    return undefined;
  }

  return asString((metadata as Record<string, unknown>)[key]);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
