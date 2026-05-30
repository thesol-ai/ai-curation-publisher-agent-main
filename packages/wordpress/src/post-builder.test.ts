import { describe, expect, it } from "vitest";
import { buildWordPressPostPayload } from "./post-builder";
import { createMockWordPressOutput } from "./wordpress-output";

describe("buildWordPressPostPayload", () => {
  it("builds a WordPress post payload from WordPress AI output", () => {
    const payload = buildWordPressPostPayload({
      output: createMockWordPressOutput({
        title_fa: "عنوان تست",
        excerpt_fa: "چکیده تست",
        body_fa: "بدنه تست",
        tags: ["tag-a"],
        categories: ["category-a"],
        source_attribution: "Source: local"
      }),
      sourceUrl: "https://source.local/post",
      slug: "custom-slug",
      featuredImageUrl: "https://source.local/image.png"
    });

    expect(payload.title).toBe("عنوان تست");
    expect(payload.excerpt).toBe("چکیده تست");
    expect(payload.content).toContain("بدنه تست");
    expect(payload.content).toContain("Source: local");
    expect(payload.content).toContain("https://source.local/post");
    expect(payload.status).toBe("draft");
    expect(payload.slug).toBe("custom-slug");
    expect(payload.sourceUrl).toBe("https://source.local/post");
    expect(payload.sourceAttribution).toBe("Source: local");
    expect(payload.tags).toEqual(["tag-a"]);
    expect(payload.categories).toEqual(["category-a"]);
    expect(payload.featuredImageUrl).toBe("https://source.local/image.png");
  });

  it("defaults status to draft", () => {
    const payload = buildWordPressPostPayload({
      output: createMockWordPressOutput()
    });

    expect(payload.status).toBe("draft");
  });

  it("maps SEO fields into metadata", () => {
    const payload = buildWordPressPostPayload({
      output: createMockWordPressOutput({
        seo_title: "SEO title",
        seo_description: "SEO description"
      })
    });

    expect(payload.meta).toMatchObject({
      seo_title: "SEO title",
      seo_description: "SEO description"
    });
  });
});
