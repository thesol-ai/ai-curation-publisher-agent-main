import { describe, expect, it } from "vitest";
import { handleReady } from "./ready";
import { handleStatus } from "./status";
import type { Env } from "../types";

const hiddenRuntimeValue = "opaque-runtime-value";

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    DB: {} as D1Database,
    ENVIRONMENT: "test",
    LOG_LEVEL: "debug",
    TELEGRAM_REVIEW_CHAT_ID: "review-chat",
    TELEGRAM_FINAL_CHAT_ID: "final-chat",
    WORDPRESS_BASE_URL: "https://wordpress.local",
    WORDPRESS_USERNAME: "editor",
    WORDPRESS_APPLICATION_PASSWORD: hiddenRuntimeValue,
    WORDPRESS_REAL_DRY_RUN_ENABLED: "true",
    WORDPRESS_DEFAULT_STATUS: "draft",
    ...overrides
  };
}

async function json(response: Response): Promise<Record<string, unknown>> {
  return response.json() as Promise<Record<string, unknown>>;
}

describe("WordPress dry-run status redaction", () => {
  it("status exposes booleans without WordPress credential values", async () => {
    const response = await handleStatus(new Request("https://worker.local/status"), makeEnv());
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(body.wordpress).toMatchObject({
      configured: true,
      baseUrlConfigured: true,
      credentialsConfigured: true,
      realDryRunEnabled: true,
      defaultStatus: "draft"
    });
    expect(JSON.stringify(body)).not.toContain("editor");
    expect(JSON.stringify(body)).not.toContain(hiddenRuntimeValue);
    expect(JSON.stringify(body)).not.toContain("wordpress.local");
  });

  it("readiness exposes safe WordPress summary without credential values", async () => {
    const response = await handleReady(new Request("https://worker.local/ready"), makeEnv());
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(body.summary).toMatchObject({
      hasWordPressConfig: true,
      hasWordPressBaseUrl: true,
      hasWordPressCredentials: true,
      wordpressRealDryRunEnabled: true,
      wordpressDefaultStatus: "draft"
    });
    expect(JSON.stringify(body)).not.toContain("editor");
    expect(JSON.stringify(body)).not.toContain(hiddenRuntimeValue);
    expect(JSON.stringify(body)).not.toContain("wordpress.local");
  });
});
