import { describe, expect, it } from "vitest";
import type { NormalizedPost } from "./item";
import {
  hasCanonicalUrl,
  hasContent,
  hasSourceIdentity,
  isAllowedCanonicalUrl,
  validateNormalizedPost
} from "./validation";

function makePost(overrides: Partial<NormalizedPost> = {}): NormalizedPost {
  return {
    provider: "mock_social_provider",
    platform: "manual",
    sourceType: "manual",
    sourcePostId: "message-local",
    canonicalUrl: "telegram://manual/chat/message",
    text: "Manual input",
    links: [],
    media: [],
    rawPayload: {},
    ...overrides
  };
}

type OptionalNormalizedPostKey = "sourcePostId" | "text";

function makePostWithout(
  omittedKeys: OptionalNormalizedPostKey[],
  overrides: Partial<NormalizedPost> = {}
): NormalizedPost {
  const post = makePost(overrides);

  for (const key of omittedKeys) {
    delete post[key];
  }

  return post;
}

describe("validateNormalizedPost", () => {
  it("accepts a valid manual text post", () => {
    expect(validateNormalizedPost(makePost()).valid).toBe(true);
  });

  it("requires a canonical URL", () => {
    const result = validateNormalizedPost(makePost({ canonicalUrl: " " }));

    expect(hasCanonicalUrl(makePost({ canonicalUrl: " " }))).toBe(false);
    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain("missing_canonical_url");
  });

  it("allows http, https, and internal telegram canonical URLs", () => {
    expect(isAllowedCanonicalUrl("http://source.local/post")).toBe(true);
    expect(isAllowedCanonicalUrl("https://source.local/post")).toBe(true);
    expect(isAllowedCanonicalUrl("telegram://manual/chat/message")).toBe(true);
  });

  it("rejects invalid canonical URLs", () => {
    const result = validateNormalizedPost(makePost({ canonicalUrl: "not-a-url" }));

    expect(isAllowedCanonicalUrl("not-a-url")).toBe(false);
    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain("invalid_canonical_url");
  });

  it("requires source post ID or fallback identity", () => {
    const post = makePostWithout(["sourcePostId", "text"], { links: [], media: [] });
    const result = validateNormalizedPost(post);

    expect(hasSourceIdentity(post)).toBe(false);
    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain("missing_source_identity");
  });

  it("allows fallback identity from text, link, or media", () => {
    expect(hasSourceIdentity(makePostWithout(["sourcePostId"], { text: "fallback", links: [], media: [] }))).toBe(true);
    expect(hasSourceIdentity(makePostWithout(["sourcePostId", "text"], { links: ["https://source.local"], media: [] }))).toBe(true);
    expect(hasSourceIdentity(makePostWithout(["sourcePostId", "text"], {
      links: [],
      media: [{ kind: "image", sourceUrl: "https://source.local/image.png" }]
    }))).toBe(true);
  });

  it("requires at least one content field", () => {
    const post = makePost({ text: " ", links: [], media: [] });
    const result = validateNormalizedPost(post);

    expect(hasContent(post)).toBe(false);
    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain("missing_content");
  });

  it("rejects unsupported platforms and source types", () => {
    const result = validateNormalizedPost(
      makePost({
        platform: "unsupported" as NormalizedPost["platform"],
        sourceType: "unsupported" as NormalizedPost["sourceType"]
      })
    );

    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain("invalid_platform");
    expect(result.issues.map((issue) => issue.code)).toContain("invalid_source_type");
  });
});
