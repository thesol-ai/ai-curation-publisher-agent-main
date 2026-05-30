import { describe, expect, it, vi } from "vitest";
import { handleScheduledPoll, runScheduledPoll } from "./poller";
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

describe("guarded scheduled poller", () => {
  it("returns a skipped result by default", async () => {
    const result = await runScheduledPoll({
      env: makeEnv(),
      scheduledTime: 1_700_000_000,
      cron: "*/30 * * * *"
    });

    expect(result).toMatchObject({
      ok: true,
      skipped: true,
      reason: "scheduler_disabled",
      schedulerEnabled: false,
      scheduledTime: 1_700_000_000,
      cron: "*/30 * * * *"
    });
  });

  it("does not crash when Cloudflare scheduled handler runs", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await expect(handleScheduledPoll({
      scheduledTime: 1_700_000_000,
      cron: "*/30 * * * *",
      noRetry: () => undefined
    } as unknown as ScheduledController, makeEnv())).resolves.toBeUndefined();

    expect(logSpy).toHaveBeenCalledWith("Scheduled poll completed", expect.objectContaining({
      ok: true,
      skipped: true,
      reason: "scheduler_disabled"
    }));

    logSpy.mockRestore();
  });
});
