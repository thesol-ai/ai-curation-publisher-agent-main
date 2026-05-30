import type { NormalizedPost } from "./item";

export type DedupeKeyType =
  | "platform_source_post_id"
  | "canonical_url_hash"
  | "normalized_text_hash"
  | "media_url_hash"
  | "fallback_composite";

export type DedupeKeyInput = {
  keyType: DedupeKeyType;
  keyValue: string;
};

export function stableHash(value: string): string {
  let hash = 5381;

  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(index);
  }

  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

export function normalizeCanonicalUrl(value: string): string {
  const trimmed = value.trim();

  if (!trimmed) {
    return "";
  }

  if (trimmed.startsWith("telegram://")) {
    return trimmed;
  }

  try {
    const url = new URL(trimmed);
    url.hash = "";
    url.hostname = url.hostname.toLowerCase();

    if ((url.protocol === "https:" && url.port === "443") || (url.protocol === "http:" && url.port === "80")) {
      url.port = "";
    }

    if (url.pathname.length > 1) {
      url.pathname = url.pathname.replace(/\/+$/, "");
    }

    url.searchParams.sort();
    return url.toString();
  } catch {
    return trimmed.toLowerCase();
  }
}

export function hashCanonicalUrl(value: string): string {
  return stableHash(normalizeCanonicalUrl(value));
}

export function hashNormalizedText(value: string): string {
  return stableHash(normalizeText(value));
}

export function hashMediaUrl(value: string): string {
  return stableHash(normalizeCanonicalUrl(value));
}

export function createStableId(prefix: string, seed: string): string {
  return `${prefix}_${stableHash(seed)}`;
}

export function createFallbackCompositeKey(post: NormalizedPost): string {
  const seed = [
    post.platform,
    post.sourceType,
    post.publishedAt ?? "",
    post.authorHandle ?? "",
    post.text ? hashNormalizedText(post.text) : "",
    post.links.map(normalizeCanonicalUrl).sort().join("|"),
    post.media.map((media) => hashMediaUrl(media.canonicalUrl ?? media.sourceUrl)).sort().join("|")
  ].join("::");

  return stableHash(seed);
}

export function generateDedupeKeys(post: NormalizedPost): DedupeKeyInput[] {
  const keys: DedupeKeyInput[] = [];

  if (post.sourcePostId?.trim()) {
    keys.push({
      keyType: "platform_source_post_id",
      keyValue: `${post.platform}:${post.sourcePostId.trim()}`
    });
  }

  if (post.canonicalUrl.trim()) {
    keys.push({
      keyType: "canonical_url_hash",
      keyValue: hashCanonicalUrl(post.canonicalUrl)
    });
  }

  if (post.text?.trim()) {
    keys.push({
      keyType: "normalized_text_hash",
      keyValue: hashNormalizedText(post.text)
    });
  }

  for (const media of post.media) {
    const mediaUrl = media.canonicalUrl ?? media.sourceUrl;

    if (mediaUrl.trim()) {
      keys.push({
        keyType: "media_url_hash",
        keyValue: hashMediaUrl(mediaUrl)
      });
    }
  }

  keys.push({
    keyType: "fallback_composite",
    keyValue: createFallbackCompositeKey(post)
  });

  return uniqueDedupeKeys(keys);
}

function uniqueDedupeKeys(keys: DedupeKeyInput[]): DedupeKeyInput[] {
  const seen = new Set<string>();

  return keys.filter((key) => {
    const signature = `${key.keyType}:${key.keyValue}`;

    if (seen.has(signature)) {
      return false;
    }

    seen.add(signature);
    return true;
  });
}
