import { describe, expect, it } from "vitest";
import {
  createFallbackCompositeKey,
  generateDedupeKeys,
  hashCanonicalUrl,
  hashMediaUrl,
  hashNormalizedText,
  normalizeCanonicalUrl,
  normalizeText
} from "./dedupe";
import type { NormalizedPost } from "./item";

function makePost(overrides: Partial<NormalizedPost> = {}): NormalizedPost {
  return {
    provider: "mock_social_provider",
    platform: "manual",
    sourceType: "web_url",
    sourcePostId: "post-local",
    canonicalUrl: "https://source.local/post?b=2&a=1#section",
    text: "  Same   TEXT ",
    links: ["https://source.local/post"],
    media: [
      {
        kind: "image",
        sourceUrl: "https://source.local/image.png?b=2&a=1"
      }
    ],
    rawPayload: {},
    ...overrides
  };
}

describe("dedupe helpers", () => {
  it("normalizes text before hashing", () => {
    expect(normalizeText("  Same   TEXT ")).toBe("same text");
    expect(hashNormalizedText("Same TEXT")).toBe(hashNormalizedText(" same   text "));
  });

  it("normalizes canonical URLs", () => {
    expect(normalizeCanonicalUrl("HTTPS://SOURCE.LOCAL/post?b=2&a=1#ignored")).toBe(
      "https://source.local/post?a=1&b=2"
    );
  });

  it("treats equivalent canonical URLs as the same hash", () => {
    expect(hashCanonicalUrl("https://source.local/post?a=1&b=2")).toBe(
      hashCanonicalUrl("https://source.local/post?b=2&a=1#ignored")
    );
  });

  it("treats equivalent media URLs as the same hash", () => {
    expect(hashMediaUrl("https://source.local/media.png?b=2&a=1")).toBe(
      hashMediaUrl("https://source.local/media.png?a=1&b=2")
    );
  });

  it("generates an exact platform and source post ID key", () => {
    const keys = generateDedupeKeys(makePost());

    expect(keys).toContainEqual({
      keyType: "platform_source_post_id",
      keyValue: "manual:post-local"
    });
  });

  it("generates a canonical URL key", () => {
    const keys = generateDedupeKeys(makePost());

    expect(keys).toContainEqual({
      keyType: "canonical_url_hash",
      keyValue: hashCanonicalUrl("https://source.local/post?b=2&a=1#section")
    });
  });

  it("generates a normalized text key", () => {
    const keys = generateDedupeKeys(makePost());

    expect(keys).toContainEqual({
      keyType: "normalized_text_hash",
      keyValue: hashNormalizedText("Same TEXT")
    });
  });

  it("generates a media URL key", () => {
    const keys = generateDedupeKeys(makePost());

    expect(keys).toContainEqual({
      keyType: "media_url_hash",
      keyValue: hashMediaUrl("https://source.local/image.png?a=1&b=2")
    });
  });

  it("generates a fallback composite key", () => {
    const post = makePost();
    const keys = generateDedupeKeys(post);

    expect(keys).toContainEqual({
      keyType: "fallback_composite",
      keyValue: createFallbackCompositeKey(post)
    });
  });

  it("removes duplicate key entries when the same key appears twice", () => {
    const keys = generateDedupeKeys(
      makePost({
        media: [
          { kind: "image", sourceUrl: "https://source.local/media.png?b=2&a=1" },
          { kind: "image", sourceUrl: "https://source.local/media.png?a=1&b=2#ignored" }
        ]
      })
    );

    const mediaKeys = keys.filter((key) => key.keyType === "media_url_hash");
    expect(mediaKeys).toHaveLength(1);
  });
});
