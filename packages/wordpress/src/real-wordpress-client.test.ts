import { describe, expect, it, vi } from "vitest";
import { RealWordPressClient, WordPressClientError } from "./real-wordpress-client";

const localAuthValue = "local-auth-value";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

describe("RealWordPressClient", () => {
  it("builds a draft post request using injected fetch", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      id: 123,
      link: "https://wordpress.local/dry-run-post",
      status: "draft",
      slug: "dry-run-post",
      date_gmt: "2026-01-01T00:00:00"
    })) as unknown as typeof fetch;
    const client = new RealWordPressClient({
      baseUrl: "https://wordpress.local/",
      username: "editor",
      applicationPassword: localAuthValue,
      fetchImpl
    });

    const result = await client.createPost({
      title: "Dry-run post title",
      excerpt: "Dry-run post excerpt",
      content: "Dry-run post content",
      status: "draft",
      sourceUrl: "https://example.com/source"
    });

    expect(result).toEqual({
      id: "123",
      url: "https://wordpress.local/dry-run-post",
      status: "draft",
      slug: "dry-run-post",
      createdAt: "2026-01-01T00:00:00"
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = vi.mocked(fetchImpl).mock.calls[0] ?? [];
    expect(url).toBe("https://wordpress.local/wp-json/wp/v2/posts");
    expect(init).toMatchObject({ method: "POST" });
    expect(JSON.parse(String(init?.body))).toMatchObject({
      title: "Dry-run post title",
      excerpt: "Dry-run post excerpt",
      content: "Dry-run post content",
      status: "draft"
    });
    expect(String((init?.headers as Record<string, string>).authorization)).toMatch(/^Basic /);
    expect(String((init?.headers as Record<string, string>).authorization)).not.toContain(localAuthValue);
  });

  it("defaults to draft status", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      id: 124,
      link: "https://wordpress.local/default-draft",
      status: "draft"
    })) as unknown as typeof fetch;
    const client = new RealWordPressClient({
      baseUrl: "https://wordpress.local",
      username: "editor",
      applicationPassword: localAuthValue,
      fetchImpl
    });

    await client.createPost({
      title: "Default draft",
      excerpt: "Excerpt",
      content: "Content"
    });

    const [, init] = vi.mocked(fetchImpl).mock.calls[0] ?? [];
    expect(JSON.parse(String(init?.body))).toMatchObject({ status: "draft" });
  });

  it("reports missing credentials without calling fetch", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const client = new RealWordPressClient({ fetchImpl });

    await expect(client.createPost({
      title: "Title",
      excerpt: "Excerpt",
      content: "Content"
    })).rejects.toMatchObject({
      name: "WordPressClientError",
      category: "missing_credentials"
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("classifies unauthorized errors without exposing credentials", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ code: "rest_forbidden" }, 401)) as unknown as typeof fetch;
    const client = new RealWordPressClient({
      baseUrl: "https://wordpress.local",
      username: "editor",
      applicationPassword: localAuthValue,
      fetchImpl
    });

    await expect(client.createPost({
      title: "Title",
      excerpt: "Excerpt",
      content: "Content"
    })).rejects.toBeInstanceOf(WordPressClientError);

    try {
      await client.createPost({
        title: "Title",
        excerpt: "Excerpt",
        content: "Content"
      });
    } catch (error) {
      expect(error).toMatchObject({
        category: "unauthorized",
        message: "WordPress REST API rejected authentication or authorization."
      });
      expect(JSON.stringify(error)).not.toContain(localAuthValue);
      expect(String((error as Error).message)).not.toContain(localAuthValue);
    }
  });

  it("classifies invalid JSON responses", async () => {
    const fetchImpl = vi.fn(async () => new Response("not-json", { status: 200 })) as unknown as typeof fetch;
    const client = new RealWordPressClient({
      baseUrl: "https://wordpress.local",
      username: "editor",
      applicationPassword: localAuthValue,
      fetchImpl
    });

    await expect(client.createPost({
      title: "Title",
      excerpt: "Excerpt",
      content: "Content"
    })).rejects.toMatchObject({ category: "invalid_response" });
  });

  it("classifies network errors", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("network failed");
    }) as unknown as typeof fetch;
    const client = new RealWordPressClient({
      baseUrl: "https://wordpress.local",
      username: "editor",
      applicationPassword: localAuthValue,
      fetchImpl
    });

    await expect(client.createPost({
      title: "Title",
      excerpt: "Excerpt",
      content: "Content"
    })).rejects.toMatchObject({ category: "network_error" });
  });
});
