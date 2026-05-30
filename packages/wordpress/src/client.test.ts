import { describe, expect, it } from "vitest";
import { MockWordPressClient } from "./client";

describe("MockWordPressClient", () => {
  it("creates draft posts without external calls", async () => {
    const client = new MockWordPressClient({ baseUrl: "https://wordpress.local" });

    const result = await client.createPost({
      title: "Draft title",
      excerpt: "Draft excerpt",
      content: "Draft content"
    });

    expect(result.id).toBe("mock_wp_post_1");
    expect(result.status).toBe("draft");
    expect(result.url).toBe("https://wordpress.local/draft-title");
    expect(client.createdPosts).toHaveLength(1);
  });

  it("can simulate createPost failures", async () => {
    const client = new MockWordPressClient({ failCreatePostWith: "mock failure" });

    await expect(client.createPost({
      title: "Draft title",
      excerpt: "Draft excerpt",
      content: "Draft content"
    })).rejects.toThrow("mock failure");
  });

  it("keeps uploadMedia as a local stub", async () => {
    const client = new MockWordPressClient();
    const result = await client.uploadMedia({ sourceUrl: "https://source.local/image.png" });

    expect(result.id).toBe("mock_wp_media_1");
    expect(result.url).toBe("https://source.local/image.png");
    expect(client.uploadedMedia).toHaveLength(1);
  });
});
