import { describe, expect, it } from "vitest";
import { MockWordPressClient, WordPressClientError, type WordPressClient, type WordPressPostInput, type WordPressPostResult } from "@curator/wordpress";
import { runWordPressDryRun } from "./wordpress-dry-run";
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

class FailingWordPressClient implements WordPressClient {
  async createPost(_input: WordPressPostInput): Promise<WordPressPostResult> {
    throw new WordPressClientError({
      category: "wordpress_api_error",
      message: "WordPress REST API returned an error."
    });
  }
}

describe("runWordPressDryRun", () => {
  it("uses mock mode by default without real configuration", async () => {
    const client = new MockWordPressClient();

    const result = await runWordPressDryRun({
      env: makeEnv(),
      input: {
        title: "Dry-run title",
        content: "Dry-run content",
        sourceUrl: "https://example.com/source"
      },
      client
    });

    expect(result).toMatchObject({
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
    expect(client.createdPosts[0]).toMatchObject({
      title: "Dry-run title",
      status: "draft",
      sourceUrl: "https://example.com/source"
    });
  });

  it("returns missing config when real dry-run is enabled without base URL", async () => {
    const result = await runWordPressDryRun({
      env: makeEnv(configuredWordPressEnv({
        WORDPRESS_REAL_DRY_RUN_ENABLED: "true",
        WORDPRESS_BASE_URL: ""
      })),
      input: { title: "Dry-run title", content: "Dry-run content" },
      client: new MockWordPressClient()
    });

    expect(result).toMatchObject({
      ok: false,
      mode: "real",
      inspectOnly: false,
      draftRequested: true,
      wordpressConfigured: false,
      credentialsConfigured: true,
      realDryRunEnabled: true,
      statusRequested: "draft",
      payloadPrepared: true,
      postCreated: false,
      error: "missing_config"
    });
  });

  it("returns missing config when real dry-run is enabled without credentials", async () => {
    const result = await runWordPressDryRun({
      env: makeEnv({
        WORDPRESS_REAL_DRY_RUN_ENABLED: "true",
        WORDPRESS_BASE_URL: "https://wordpress.local"
      }),
      input: { title: "Dry-run title", content: "Dry-run content" },
      client: new MockWordPressClient()
    });

    expect(result).toMatchObject({
      ok: false,
      mode: "real",
      wordpressConfigured: true,
      credentialsConfigured: false,
      error: "missing_config"
    });
  });

  it("creates draft only in real dry-run mode with injected client", async () => {
    const client = new MockWordPressClient();

    const result = await runWordPressDryRun({
      env: makeEnv(configuredWordPressEnv({
        WORDPRESS_REAL_DRY_RUN_ENABLED: "true",
        WORDPRESS_DEFAULT_STATUS: "publish"
      })),
      input: {
        title: "Real dry-run title",
        content: "Real dry-run content",
        sourceUrl: "https://example.com/source"
      },
      client
    });

    expect(result).toMatchObject({
      ok: true,
      mode: "real",
      inspectOnly: false,
      draftRequested: true,
      wordpressConfigured: true,
      credentialsConfigured: true,
      realDryRunEnabled: true,
      statusRequested: "draft",
      payloadPrepared: true,
      postCreated: true,
      wordpressPostId: "mock_wp_post_1"
    });
    expect(client.createdPosts).toHaveLength(1);
    expect(client.createdPosts[0]?.status).toBe("draft");
  });

  it("returns typed WordPress client failures without exposing configured values", async () => {
    const result = await runWordPressDryRun({
      env: makeEnv(configuredWordPressEnv({ WORDPRESS_REAL_DRY_RUN_ENABLED: "true" })),
      input: { title: "Dry-run title", content: "Dry-run content" },
      client: new FailingWordPressClient()
    });

    expect(result).toMatchObject({
      ok: false,
      mode: "real",
      error: "wordpress_api_error",
      message: "WordPress REST API returned an error."
    });
    expect(JSON.stringify(result)).not.toContain(hiddenRuntimeValue);
  });
});
