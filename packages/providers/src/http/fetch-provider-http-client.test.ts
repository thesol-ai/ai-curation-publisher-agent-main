import { describe, expect, it, vi } from "vitest";
import { FetchProviderHttpClient } from "./fetch-provider-http-client";

describe("FetchProviderHttpClient", () => {
  it("returns typed success for valid JSON", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const client = new FetchProviderHttpClient({ fetchImpl });

    const result = await client.getJson<{ ok: boolean }>("https://provider.local/data");

    expect(result).toMatchObject({ ok: true, data: { ok: true }, status: 200 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("classifies HTTP errors", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ error: "bad" }), { status: 500 }));
    const client = new FetchProviderHttpClient({ fetchImpl });

    const result = await client.getJson("https://provider.local/data");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.category).toBe("http_error");
      expect(result.error.statusCode).toBe(500);
    }
  });

  it("classifies rate limits", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ error: "limited" }), { status: 429 }));
    const client = new FetchProviderHttpClient({ fetchImpl });

    const result = await client.getJson("https://provider.local/data");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.category).toBe("rate_limited");
      expect(result.error.statusCode).toBe(429);
    }
  });

  it("classifies invalid JSON", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response("not-json", { status: 200 }));
    const client = new FetchProviderHttpClient({ fetchImpl });

    const result = await client.getJson("https://provider.local/data");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.category).toBe("invalid_response");
    }
  });

  it("classifies network errors", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new Error("connection failed"));
    const client = new FetchProviderHttpClient({ fetchImpl });

    const result = await client.getJson("https://provider.local/data");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.category).toBe("network_error");
      expect(result.error.message).toBe("connection failed");
    }
  });

  it("classifies timeout aborts", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new DOMException("aborted", "AbortError"));
    const client = new FetchProviderHttpClient({ fetchImpl });

    const result = await client.getJson("https://provider.local/data", { timeoutMs: 1 });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.category).toBe("timeout");
    }
  });
});
