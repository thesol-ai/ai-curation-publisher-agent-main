import { describe, expect, it, vi } from "vitest";
import { InMemoryRateLimitGuard, NoopRateLimitGuard } from "./rate-limit";

describe("rate limit guards", () => {
  it("allows requests by default", async () => {
    const guard = new NoopRateLimitGuard();

    await expect(guard.check(new Request("https://worker.local/internal/poll"))).resolves.toEqual({ allowed: true });
  });

  it("blocks after the configured in-memory limit", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    const guard = new InMemoryRateLimitGuard({ limit: 1, windowMs: 1_000 });
    const request = new Request("https://worker.local/internal/poll", {
      headers: { "x-forwarded-for": "127.0.0.1" }
    });

    expect(await guard.check(request)).toEqual({ allowed: true });
    expect(await guard.check(request)).toEqual({ allowed: false, retryAfterSeconds: 1, reason: "rate_limit_exceeded" });

    vi.useRealTimers();
  });
});
