import { describe, expect, it } from "vitest";
import { handleInternalAdminConfig } from "./internal-admin-config";
import type { Env } from "../types";

type Row = Record<string, string | number | null>;
class MemoryStatement { private values: unknown[] = []; constructor(private readonly db: MemoryD1, private readonly query: string) {} bind(...values: unknown[]): MemoryStatement { this.values = values; return this; } async all<T>(): Promise<{ success: boolean; results: T[] }> { return { success: true, results: this.db.all(this.query, this.values) as T[] }; } async first<T>(): Promise<T | null> { return (this.db.all(this.query, this.values)[0] as T | undefined) ?? null; } async run(): Promise<{ success: boolean }> { this.db.run(this.query, this.values); return { success: true }; } }
class MemoryD1 { config = new Map<string, Row>(); audit: Row[] = []; prepare(query: string): MemoryStatement { return new MemoryStatement(this, query); } all(query: string, values: unknown[]): Row[] { if (query.includes("admin_config_audit")) return [...this.audit].reverse().slice(0, Number(values[0] ?? 50)); return [...this.config.values()]; } run(query: string, values: unknown[]): void { if (query.startsWith("DELETE FROM admin_config")) { this.config.delete(String(values[0])); return; } if (query.includes("INSERT INTO admin_config_audit")) { this.audit.push({ id: String(values[0]), key: String(values[1]), value_type: String(values[2]), is_secret: Number(values[3]), action: String(values[4]), changed_at: String(values[5]), changed_by: String(values[6]), request_id: String(values[7]), previous_value_redacted: String(values[8]), new_value_redacted: String(values[9]) }); return; } if (query.includes("INSERT INTO admin_config")) { this.config.set(String(values[0]), { key: String(values[0]), value: String(values[1]), value_type: String(values[2]), is_secret: Number(values[3]), encrypted: Number(values[4]), updated_at: String(values[5]), updated_by: String(values[6]), description: String(values[7]) }); } } }
function makeEnv(overrides: Partial<Env> = {}): Env { return { DB: new MemoryD1() as unknown as D1Database, INTERNAL_API_SECRET: "internal-secret", ...overrides }; }
async function body(response: Response): Promise<Record<string, unknown>> { return response.json() as Promise<Record<string, unknown>>; }
function authRequest(path: string, init: RequestInit = {}): Request { return new Request(`https://worker.local${path}`, { ...init, headers: { "content-type": "application/json", "x-internal-api-secret": "internal-secret", ...(init.headers ?? {}) } }); }

describe("internal admin config route", () => {
  it("requires internal secret", async () => {
    const response = await handleInternalAdminConfig(new Request("https://worker.local/internal/admin/config"), makeEnv());
    expect(response.status).toBe(401);
  });

  it("saves non-secret config through protected route", async () => {
    const request = authRequest("/internal/admin/config", { method: "PUT", body: JSON.stringify({ key: "TELEGRAM_REAL_REVIEW_ENABLED", value: "true" }) });
    const response = await handleInternalAdminConfig(request, makeEnv());
    const json = await body(response);
    expect(response.status).toBe(200);
    expect(JSON.stringify(json)).toContain("TELEGRAM_REAL_REVIEW_ENABLED");
    expect(JSON.stringify(json)).toContain("true");
  });

  it("rejects forbidden keys", async () => {
    const request = authRequest("/internal/admin/config", { method: "PUT", body: JSON.stringify({ key: "SCHEDULER_ALLOW_PUBLISHING", value: "true" }) });
    const response = await handleInternalAdminConfig(request, makeEnv());
    const json = await body(response);
    expect(response.status).toBe(400);
    expect(json.error).toBe("config_key_not_editable");
  });

  it("blocks secret saves without encryption key", async () => {
    const request = authRequest("/internal/admin/config", { method: "PUT", body: JSON.stringify({ key: "FIRECRAWL_API_KEY", value: "hidden-value" }) });
    const response = await handleInternalAdminConfig(request, makeEnv());
    const json = await body(response);
    expect(response.status).toBe(400);
    expect(json.error).toBe("missing_config_encryption_key");
    expect(JSON.stringify(json)).not.toContain("hidden-value");
  });

  it("resets overrides and writes audit", async () => {
    const e = makeEnv();
    const save = await handleInternalAdminConfig(authRequest("/internal/admin/config", { method: "PUT", body: JSON.stringify({ key: "OPERATING_MODE", value: "mock_demo" }) }), e);
    expect(save.status).toBe(200);
    const reset = await handleInternalAdminConfig(authRequest("/internal/admin/config/reset", { method: "POST", body: JSON.stringify({ key: "OPERATING_MODE" }) }), e);
    expect(reset.status).toBe(200);
    const audit = await handleInternalAdminConfig(authRequest("/internal/admin/config/audit"), e);
    const json = await body(audit);
    expect(audit.status).toBe(200);
    expect(JSON.stringify(json)).toContain("OPERATING_MODE");
    expect(JSON.stringify(json)).toContain("reset");
  });
});
