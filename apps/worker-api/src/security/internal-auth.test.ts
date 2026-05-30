import { describe, expect, it } from "vitest";
import { verifyInternalRequest } from "./internal-auth";
import type { Env } from "../types";

function env(overrides: Partial<Env> = {}): Env {
  return {
    DB: {} as D1Database,
    ...overrides
  };
}

describe("verifyInternalRequest", () => {
  it("allows requests when INTERNAL_API_SECRET is unset", () => {
    const result = verifyInternalRequest(new Request("https://worker.local/internal/poll"), env());

    expect(result).toEqual({ ok: true, protected: false });
  });

  it("rejects requests with missing secret header when configured", () => {
    const result = verifyInternalRequest(new Request("https://worker.local/internal/poll"), env({ INTERNAL_API_SECRET: "configured" }));

    expect(result).toEqual({ ok: false, error: "internal_auth_required" });
  });

  it("rejects invalid secret header", () => {
    const result = verifyInternalRequest(new Request("https://worker.local/internal/poll", {
      headers: { "x-internal-api-secret": "wrong" }
    }), env({ INTERNAL_API_SECRET: "configured" }));

    expect(result).toEqual({ ok: false, error: "internal_auth_invalid" });
  });

  it("accepts valid secret header", () => {
    const result = verifyInternalRequest(new Request("https://worker.local/internal/poll", {
      headers: { "x-internal-api-secret": "configured" }
    }), env({ INTERNAL_API_SECRET: "configured" }));

    expect(result).toEqual({ ok: true, protected: true });
  });
});
