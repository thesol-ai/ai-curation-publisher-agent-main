import { describe, expect, it } from "vitest";
import { mapApifyInstagramResponseToPosts } from "./apify/apify-mapper";
import { mapFirecrawlResponseToPosts } from "./firecrawl/firecrawl-mapper";
import { mapGetXApiResponseToPosts } from "./getxapi/getxapi-mapper";

describe("provider response mappers", () => {
  it("maps valid Apify Instagram records", () => {
    const result = mapApifyInstagramResponseToPosts({
      items: [
        {
          id: "ig_1",
          url: "https://instagram.com/p/abc",
          caption: "caption",
          ownerUsername: "author",
          displayUrl: "https://cdn.local/image.jpg"
        }
      ]
    });

    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.posts).toHaveLength(1);
    expect(result.posts[0]).toMatchObject({
      provider: "apify_instagram",
      platform: "instagram",
      sourcePostId: "ig_1",
      canonicalUrl: "https://instagram.com/p/abc",
      text: "caption",
      authorHandle: "author"
    });
    expect(result.posts[0]?.media?.[0]).toMatchObject({ kind: "image", sourceUrl: "https://cdn.local/image.jpg" });
  });

  it("skips invalid Apify records", () => {
    const result = mapApifyInstagramResponseToPosts({ items: [{ caption: "missing url" }, "bad"] });

    expect(result.posts).toEqual([]);
    expect(result.warnings).toHaveLength(2);
    expect(result.errors).toEqual([]);
  });

  it("maps valid GetXAPI records", () => {
    const result = mapGetXApiResponseToPosts({
      tweets: [
        {
          id: "tweet_1",
          text: "tweet text",
          user: { username: "writer" },
          media: ["https://cdn.local/video.mp4"]
        }
      ]
    });

    expect(result.errors).toEqual([]);
    expect(result.posts).toHaveLength(1);
    expect(result.posts[0]).toMatchObject({
      provider: "getxapi",
      platform: "x",
      sourcePostId: "tweet_1",
      canonicalUrl: "https://x.com/i/web/status/tweet_1",
      text: "tweet text",
      authorHandle: "writer"
    });
    expect(result.posts[0]?.media?.[0]).toMatchObject({ kind: "video", sourceUrl: "https://cdn.local/video.mp4" });
  });

  it("maps valid Firecrawl records", () => {
    const result = mapFirecrawlResponseToPosts({
      data: {
        url: "https://source.local/article",
        title: "Article title",
        markdown: "Article body",
        metadata: { author: "editor", publishedTime: "2026-01-01T00:00:00.000Z" }
      }
    });

    expect(result.errors).toEqual([]);
    expect(result.posts).toHaveLength(1);
    expect(result.posts[0]).toMatchObject({
      provider: "firecrawl",
      platform: "web",
      sourcePostId: "https://source.local/article",
      canonicalUrl: "https://source.local/article",
      authorHandle: "editor",
      publishedAt: "2026-01-01T00:00:00.000Z"
    });
    expect(result.posts[0]?.text).toContain("Article title");
    expect(result.posts[0]?.text).toContain("Article body");
  });
});
