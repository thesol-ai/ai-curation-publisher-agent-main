import { describe, expect, it } from "vitest";
import { MockWordPressClient } from "@curator/wordpress";
import { handleInternalWordPressDryRun } from "./internal-wordpress-dry-run";
import type { Env } from "../types";

const hiddenRuntimeValue = "opaque-runtime-value";

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

function configuredWordPressEnv(overrides: Partial<Env> = {}): Partial<Env> {
  return {
    WORDPRESS_BASE_URL: "https://wordpress.local",
    WORDPRESS_USERNAME: "editor",
    WORDPRESS_APPLICATION_PASSWORD: hiddenRuntimeValue,
    ...overrides
  };
}

async function json(response: Response): Promise<Record<string, unknown>> {
  return response.json() as Promise<Record<string, unknown>>;
}

describe("handleInternalWordPressDryRun", () => {
  it("rejects invalid methods", async () => {
    const response = await handleInternalWordPressDryRun(
      new Request("https://worker.local/internal/wordpress/dry-run", { method: "GET" }),
      makeEnv()
    );
    const body = await json(response);

    expect(response.status).toBe(405);
    expect(body.error).toBe("method_not_allowed");
  });

  it("requires internal secret when configured", async () => {
    const response = await handleInternalWordPressDryRun(
      new Request("https://worker.local/internal/wordpress/dry-run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "Dry-run title", content: "Dry-run content" })
      }),
      makeEnv({ INTERNAL_API_SECRET: "configured-secret" })
    );
    const body = await json(response);

    expect(response.status).toBe(401);
    expect(body.error).toBe("internal_auth_required");
    expect(JSON.stringify(body)).not.toContain("configured-secret");
  });

  it("rejects missing title", async () => {
    const response = await handleInternalWordPressDryRun(
      new Request("https://worker.local/internal/wordpress/dry-run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: "Dry-run content" })
      }),
      makeEnv()
    );
    const body = await json(response);

    expect(response.status).toBe(400);
    expect(body.error).toBe("missing_title");
  });

  it("rejects invalid sourceUrl", async () => {
    const response = await handleInternalWordPressDryRun(
      new Request("https://worker.local/internal/wordpress/dry-run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "Dry-run title", content: "Dry-run content", sourceUrl: "not-a-url" })
      }),
      makeEnv()
    );
    const body = await json(response);

    expect(response.status).toBe(400);
    expect(body.error).toBe("invalid_source_url");
  });

  it("succeeds in mock mode without WordPress config", async () => {
    const client = new MockWordPressClient();
    const response = await handleInternalWordPressDryRun(
      new Request("https://worker.local/internal/wordpress/dry-run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: "Dry-run title",
          content: "Dry-run content",
          sourceUrl: "https://example.com/source"
        })
      }),
      makeEnv(),
      undefined,
      client
    );
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      mode: "mock",
      inspectOnly: true,
      draftRequested: true,
      wordpressConfigured: false,
      credentialsConfigured: false,
      realDryRunEnabled: false,
      statusRequested: "draft",
      payloadPrepared: true,
      postCreated: true,
      wordpressPostId: "mock_wp_post_1"
    });
    expect(client.createdPosts).toHaveLength(1);
    expect(client.createdPosts[0]?.status).toBe("draft");
  });

  it("returns missing config when real dry-run is enabled without WordPress config", async () => {
    const response = await handleInternalWordPressDryRun(
      new Request("https://worker.local/internal/wordpress/dry-run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "Dry-run title", content: "Dry-run content" })
      }),
      makeEnv({ WORDPRESS_REAL_DRY_RUN_ENABLED: "true" }),
      undefined,
      new MockWordPressClient()
    );
    const body = await json(response);

    expect(response.status).toBe(409);
    expect(body).toMatchObject({
      ok: false,
      mode: "real",
      postCreated: false,
      error: "missing_config"
    });
  });

  it("succeeds in real mode with injected mock WordPress client and creates draft", async () => {
    const client = new MockWordPressClient();
    const response = await handleInternalWordPressDryRun(
      new Request("https://worker.local/internal/wordpress/dry-run", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-internal-api-secret": "configured-secret"
        },
        body: JSON.stringify({
          title: "Dry-run title",
          content: "Dry-run content",
          sourceUrl: "https://example.com/source"
        })
      }),
      makeEnv(configuredWordPressEnv({
        INTERNAL_API_SECRET: "configured-secret",
        WORDPRESS_REAL_DRY_RUN_ENABLED: "true",
        WORDPRESS_DEFAULT_STATUS: "publish"
      })),
      undefined,
      client
    );
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      mode: "real",
      inspectOnly: false,
      draftRequested: true,
      wordpressConfigured: true,
      credentialsConfigured: true,
      realDryRunEnabled: true,
      statusRequested: "draft",
      payloadPrepared: true,
      postCreated: true
    });
    expect(JSON.stringify(body)).not.toContain(hiddenRuntimeValue);
    expect(client.createdPosts).toHaveLength(1);
    expect(client.createdPosts[0]?.status).toBe("draft");
  });
});
