import { describe, expect, it } from "vitest";
import { MockProviderHttpClient } from "@curator/providers";
import { runFirecrawlSandboxFetch } from "./firecrawl-sandbox";
import type { Env } from "../types";

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    DB: {} as D1Database,
    ENVIRONMENT: "test",
    LOG_LEVEL: "debug",
    TELEGRAM_REVIEW_CHAT_ID: "review-chat",
    TELEGRAM_FINAL_CHAT_ID: "final-chat",
    ...overrides
  };
}

describe("runFirecrawlSandboxFetch", () => {
  it("returns disabled by default without HTTP calls", async () => {
    const httpClient = new MockProviderHttpClient();

    const result = await runFirecrawlSandboxFetch({
      env: makeEnv(),
      input: { url: "https://source.local/article" },
      httpClient
    });

    expect(result).toMatchObject({
      ok: false,
      inspectOnly: true,
      providerId: "firecrawl",
      enabled: false,
      configured: false,
      status: "disabled",
      normalizedCount: 0,
      posts: []
    });
    expect(httpClient.requests).toEqual([]);
  });

  it("returns missing credentials without HTTP calls", async () => {
    const httpClient = new MockProviderHttpClient();

    const result = await runFirecrawlSandboxFetch({
      env: makeEnv({
        PROVIDERS_MODE: "mixed",
        ENABLE_FIRECRAWL_PROVIDER: "true"
      }),
      input: { url: "https://source.local/article" },
      httpClient
    });

    expect(result).toMatchObject({
      ok: false,
      inspectOnly: true,
      providerId: "firecrawl",
      enabled: false,
      configured: false,
      status: "missing_credentials",
      error: "missing_credentials"
    });
    expect(httpClient.requests).toEqual([]);
  });

  it("uses mock HTTP client to return normalized Firecrawl posts", async () => {
    const httpClient = new MockProviderHttpClient([
      {
        method: "POST",
        url: "https://firecrawl.sandbox.local/scrape",
        response: {
          data: {
            url: "https://source.local/article",
            title: "Sandbox title",
            markdown: "Sandbox body",
            metadata: { author: "editor" }
          }
        }
      }
    ]);

    const result = await runFirecrawlSandboxFetch({
      env: makeEnv({
        PROVIDERS_MODE: "mixed",
        ENABLE_FIRECRAWL_PROVIDER: "true",
        FIRECRAWL_API_KEY: "in-memory-key",
        FIRECRAWL_BASE_URL: "https://firecrawl.sandbox.local/scrape",
        FIRECRAWL_TIMEOUT_MS: "1234"
      } as Partial<Env>),
      input: { url: "https://source.local/article", limit: 1 },
      httpClient
    });

    expect(result.ok).toBe(true);
    expect(result.inspectOnly).toBe(true);
    expect(result.normalizedCount).toBe(1);
    expect(result.posts).toHaveLength(1);
    expect(result.posts[0]).toMatchObject({
      provider: "firecrawl",
      platform: "web",
      canonicalUrl: "https://source.local/article",
      authorHandle: "editor"
    });
    expect(httpClient.requests).toHaveLength(1);
    expect(httpClient.requests[0]).toMatchObject({
      method: "POST",
      url: "https://firecrawl.sandbox.local/scrape"
    });
  });

  it("returns typed HTTP failures without throwing", async () => {
    const httpClient = new MockProviderHttpClient([], [
      {
        method: "POST",
        url: "https://firecrawl.sandbox.local/scrape",
        error: {
          category: "http_error",
          message: "Provider HTTP request failed with 500",
          statusCode: 500
        },
        status: 500
      }
    ]);

    const result = await runFirecrawlSandboxFetch({
      env: makeEnv({
        PROVIDERS_MODE: "mixed",
        ENABLE_FIRECRAWL_PROVIDER: "true",
        FIRECRAWL_API_KEY: "in-memory-key",
        FIRECRAWL_BASE_URL: "https://firecrawl.sandbox.local/scrape"
      } as Partial<Env>),
      input: { url: "https://source.local/article" },
      httpClient
    });

    expect(result).toMatchObject({
      ok: false,
      inspectOnly: true,
      providerId: "firecrawl",
      status: "http_error",
      error: "http_error",
      normalizedCount: 0,
      posts: []
    });
  });
});
