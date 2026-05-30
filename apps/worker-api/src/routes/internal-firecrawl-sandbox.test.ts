import { describe, expect, it } from "vitest";
import { MockProviderHttpClient } from "@curator/providers";
import { handleInternalFirecrawlSandbox } from "./internal-firecrawl-sandbox";
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

async function json(response: Response): Promise<Record<string, unknown>> {
  return response.json() as Promise<Record<string, unknown>>;
}

describe("handleInternalFirecrawlSandbox", () => {
  it("rejects invalid methods", async () => {
    const response = await handleInternalFirecrawlSandbox(
      new Request("https://worker.local/internal/providers/firecrawl/sandbox-fetch", { method: "GET" }),
      makeEnv()
    );
    const body = await json(response);

    expect(response.status).toBe(405);
    expect(body.error).toBe("method_not_allowed");
  });

  it("requires internal secret when configured", async () => {
    const response = await handleInternalFirecrawlSandbox(
      new Request("https://worker.local/internal/providers/firecrawl/sandbox-fetch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: "https://source.local/article" })
      }),
      makeEnv({ INTERNAL_API_SECRET: "configured-secret" })
    );
    const body = await json(response);

    expect(response.status).toBe(401);
    expect(body.error).toBe("internal_auth_required");
    expect(JSON.stringify(body)).not.toContain("configured-secret");
  });

  it("rejects invalid URL input", async () => {
    const response = await handleInternalFirecrawlSandbox(
      new Request("https://worker.local/internal/providers/firecrawl/sandbox-fetch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: "not-a-url" })
      }),
      makeEnv()
    );
    const body = await json(response);

    expect(response.status).toBe(400);
    expect(body.error).toBe("invalid_url");
  });

  it("rejects when Firecrawl is disabled by default", async () => {
    const httpClient = new MockProviderHttpClient();
    const response = await handleInternalFirecrawlSandbox(
      new Request("https://worker.local/internal/providers/firecrawl/sandbox-fetch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: "https://source.local/article" })
      }),
      makeEnv(),
      undefined,
      httpClient
    );
    const body = await json(response);

    expect(response.status).toBe(409);
    expect(body).toMatchObject({
      ok: false,
      inspectOnly: true,
      providerId: "firecrawl",
      status: "disabled",
      normalizedCount: 0
    });
    expect(httpClient.requests).toEqual([]);
  });

  it("succeeds with mock HTTP client when Firecrawl is explicitly enabled", async () => {
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

    const response = await handleInternalFirecrawlSandbox(
      new Request("https://worker.local/internal/providers/firecrawl/sandbox-fetch", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-internal-api-secret": "configured-secret"
        },
        body: JSON.stringify({ url: "https://source.local/article" })
      }),
      makeEnv({
        INTERNAL_API_SECRET: "configured-secret",
        PROVIDERS_MODE: "mixed",
        ENABLE_FIRECRAWL_PROVIDER: "true",
        FIRECRAWL_API_KEY: "in-memory-key",
        FIRECRAWL_BASE_URL: "https://firecrawl.sandbox.local/scrape"
      } as Partial<Env>),
      undefined,
      httpClient
    );
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      inspectOnly: true,
      providerId: "firecrawl",
      normalizedCount: 1
    });
    expect(body.posts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        provider: "firecrawl",
        platform: "web",
        canonicalUrl: "https://source.local/article"
      })
    ]));
    expect(JSON.stringify(body)).not.toContain("in-memory-key");
    expect(httpClient.requests).toHaveLength(1);
  });
});
