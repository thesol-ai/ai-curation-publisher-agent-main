import { describe, expect, it } from "vitest";
import { handleInternalSchedulerRun } from "./internal-scheduler-run";
import type { Env } from "../types";

function makeEnv(overrides: Record<string, string | undefined> = {}): Env {
  return {
    DB: {} as D1Database,
    ENVIRONMENT: "test",
    LOG_LEVEL: "debug",
    TELEGRAM_REVIEW_CHAT_ID: "review-chat",
    TELEGRAM_FINAL_CHAT_ID: "final-chat",
    ...overrides
  } as Env;
}

async function json(response: Response): Promise<Record<string, unknown>> {
  return response.json() as Promise<Record<string, unknown>>;
}

describe("handleInternalSchedulerRun", () => {
  it("rejects invalid methods", async () => {
    const response = await handleInternalSchedulerRun(
      new Request("https://worker.local/internal/scheduler/run", { method: "GET" }),
      makeEnv()
    );
    const body = await json(response);

    expect(response.status).toBe(405);
    expect(body.error).toBe("method_not_allowed");
  });

  it("requires internal secret when configured", async () => {
    const response = await handleInternalSchedulerRun(
      new Request("https://worker.local/internal/scheduler/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dryRun: true })
      }),
      makeEnv({ INTERNAL_API_SECRET: "configured-secret" })
    );
    const body = await json(response);

    expect(response.status).toBe(401);
    expect(body.error).toBe("internal_auth_required");
    expect(JSON.stringify(body)).not.toContain("configured-secret");
  });

  it("runs a manual mock-safe dry-run even when scheduler is disabled", async () => {
    const response = await handleInternalSchedulerRun(
      new Request("https://worker.local/internal/scheduler/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dryRun: true, maxSources: 1, maxItems: 1 })
      }),
      makeEnv()
    );
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      skipped: false,
      dryRun: true,
      schedulerEnabled: false,
      realProvidersAllowed: false,
      publishingAllowed: false,
      maxSources: 1,
      maxItems: 1,
      totalSources: 1,
      totalQueued: 0
    });
  });

  it("does not publish by default", async () => {
    const response = await handleInternalSchedulerRun(
      new Request("https://worker.local/internal/scheduler/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dryRun: false, maxSources: 1, maxItems: 1 })
      }),
      makeEnv({ SCHEDULER_ALLOW_PUBLISHING: "false" })
    );
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(body.publishingAllowed).toBe(false);
    expect(body.totalQueued).toBeGreaterThanOrEqual(0);
  });

  it("records warnings when real providers are allowed but keeps mock-safe behavior", async () => {
    const response = await handleInternalSchedulerRun(
      new Request("https://worker.local/internal/scheduler/run", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-internal-api-secret": "configured-secret"
        },
        body: JSON.stringify({ dryRun: true, maxSources: 1, maxItems: 1 })
      }),
      makeEnv({
        INTERNAL_API_SECRET: "configured-secret",
        PROVIDERS_MODE: "mixed",
        SCHEDULER_ALLOW_REAL_PROVIDERS: "true"
      })
    );
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(body.realProvidersAllowed).toBe(true);
    expect(body.providersMode).toBe("mixed");
    expect(body.warnings).toEqual(expect.arrayContaining([
      "Real provider scheduler access is allowed by config, but Phase 21 still uses mock-safe polling only."
    ]));
  });
});
