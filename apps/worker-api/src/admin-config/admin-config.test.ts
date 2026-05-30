import { describe, expect, it } from "vitest";
import { ADMIN_CONFIG_DEFINITIONS, findAdminConfigDefinition, isEditableAdminConfigKey, isForbiddenAdminConfigKey } from "./allowlist";
import { decryptSecretValue, encryptSecretValue } from "./crypto";
import { getEffectiveEnv, listAdminConfigAudit, listEditableConfig, resetConfigValues, setConfigValues } from "./service";
import { validateAdminConfigValue } from "./validation";
import type { Env } from "../types";

type Row = Record<string, string | number | null>;
class MemoryStatement { private values: unknown[] = []; constructor(private readonly db: MemoryD1, private readonly query: string) {} bind(...values: unknown[]): MemoryStatement { this.values = values; return this; } async all<T>(): Promise<{ success: boolean; results: T[] }> { return { success: true, results: this.db.all(this.query, this.values) as T[] }; } async first<T>(): Promise<T | null> { return (this.db.all(this.query, this.values)[0] as T | undefined) ?? null; } async run(): Promise<{ success: boolean }> { this.db.run(this.query, this.values); return { success: true }; } }
class MemoryD1 { config = new Map<string, Row>(); audit: Row[] = []; prepare(query: string): MemoryStatement { return new MemoryStatement(this, query); } all(query: string, values: unknown[]): Row[] { if (query.includes("admin_config_audit")) return [...this.audit].reverse().slice(0, Number(values[0] ?? 50)); return [...this.config.values()]; } run(query: string, values: unknown[]): void { if (query.startsWith("DELETE FROM admin_config")) { this.config.delete(String(values[0])); return; } if (query.includes("INSERT INTO admin_config_audit")) { this.audit.push({ id: String(values[0]), key: String(values[1]), value_type: String(values[2]), is_secret: Number(values[3]), action: String(values[4]), changed_at: String(values[5]), changed_by: String(values[6]), request_id: String(values[7]), previous_value_redacted: String(values[8]), new_value_redacted: String(values[9]) }); return; } if (query.includes("INSERT INTO admin_config")) { this.config.set(String(values[0]), { key: String(values[0]), value: String(values[1]), value_type: String(values[2]), is_secret: Number(values[3]), encrypted: Number(values[4]), updated_at: String(values[5]), updated_by: String(values[6]), description: String(values[7]) }); } } }
function env(overrides: Partial<Env> = {}): Env { return { DB: new MemoryD1() as unknown as D1Database, INTERNAL_API_SECRET: "internal", ...overrides }; }
function request(): Request { return new Request("https://worker.local/internal/admin/config", { headers: { "x-admin-user": "test-admin", "x-request-id": "req-test" } }); }
const hexKey = "000102030405060708090a0b0d0e0f101112131415161718191a1b1c1d1e1f".replace("0d", "0c0d");

describe("admin config allowlist and validation", () => {
  it("permits expected editable keys and rejects forbidden keys", () => {
    expect(isEditableAdminConfigKey("OPERATING_MODE")).toBe(true);
    expect(isEditableAdminConfigKey("DEFAULT_CONTENT_SOURCE_MODE")).toBe(true);
    expect(isEditableAdminConfigKey("AI_PROVIDER")).toBe(true);
    expect(isEditableAdminConfigKey("AI_MODEL_FALLBACKS")).toBe(true);
    expect(isEditableAdminConfigKey("OPENAI_API_KEY")).toBe(true);
    expect(isEditableAdminConfigKey("TELEGRAM_REAL_REVIEW_ENABLED")).toBe(true);
    expect(isEditableAdminConfigKey("FIRECRAWL_API_KEY")).toBe(true);
    expect(isEditableAdminConfigKey("INTERNAL_API_SECRET")).toBe(false);
    expect(isForbiddenAdminConfigKey("CONFIG_ENCRYPTION_KEY")).toBe(true);
    expect(isForbiddenAdminConfigKey("SCHEDULER_ALLOW_PUBLISHING")).toBe(true);
    expect(isForbiddenAdminConfigKey("WORDPRESS_REAL_PUBLISH_ENABLED")).toBe(true);
    expect(ADMIN_CONFIG_DEFINITIONS.some((entry) => entry.key === "CLOUDFLARE_API_TOKEN")).toBe(false);
  });

  it("rejects bad values and normalizes model fallback chains", () => {
    expect(validateAdminConfigValue(findAdminConfigDefinition("TELEGRAM_REAL_REVIEW_ENABLED")!, "yes").ok).toBe(false);
    expect(validateAdminConfigValue(findAdminConfigDefinition("FIRECRAWL_TIMEOUT_MS")!, "abc").ok).toBe(false);
    expect(validateAdminConfigValue(findAdminConfigDefinition("WORDPRESS_BASE_URL")!, "http://example.com").ok).toBe(false);
    expect(validateAdminConfigValue(findAdminConfigDefinition("WORDPRESS_BASE_URL")!, "http://localhost:8080").ok).toBe(true);
    expect(validateAdminConfigValue(findAdminConfigDefinition("FIRECRAWL_BASE_URL")!, "http://127.0.0.1:8787/scrape").ok).toBe(true);
    expect(validateAdminConfigValue(findAdminConfigDefinition("WORDPRESS_DEFAULT_STATUS")!, "publish").ok).toBe(false);
    expect(validateAdminConfigValue(findAdminConfigDefinition("MAX_PUBLISH_ITEMS_PER_RUN")!, "1").ok).toBe(false);
    expect(validateAdminConfigValue(findAdminConfigDefinition("OPERATING_MODE")!, "auto_publish").ok).toBe(false);
    expect(validateAdminConfigValue(findAdminConfigDefinition("DEFAULT_CONTENT_SOURCE_MODE")!, "auto").ok).toBe(false);
    expect(validateAdminConfigValue(findAdminConfigDefinition("AI_PROVIDER")!, "unknown").ok).toBe(false);
    expect(validateAdminConfigValue(findAdminConfigDefinition("AI_MODEL_FALLBACKS")!, "[1]").ok).toBe(false);
    expect(validateAdminConfigValue(findAdminConfigDefinition("AI_MODEL_FALLBACKS")!, "model-a,,model-b").ok).toBe(false);
    expect(validateAdminConfigValue(findAdminConfigDefinition("AI_MODEL_FALLBACKS")!, "")).toMatchObject({ ok: true, value: "[]" });
    expect(validateAdminConfigValue(findAdminConfigDefinition("AI_MODEL_FALLBACKS")!, "model-a,model-b")).toMatchObject({ ok: true, value: "[\"model-a\",\"model-b\"]" });
    expect(validateAdminConfigValue(findAdminConfigDefinition("AI_TEMPERATURE")!, "2.5").ok).toBe(false);
  });

  it("returns metadata for setup and settings UI", async () => {
    const listed = await listEditableConfig(env());
    const mode = listed.items.find((item) => item.key === "OPERATING_MODE");
    const provider = listed.items.find((item) => item.key === "FIRECRAWL_API_KEY");
    const ai = listed.items.find((item) => item.key === "AI_PROVIDER");
    expect(listed.adminConfigStore.available).toBe(true);
    expect(mode).toMatchObject({ group: "operating_mode", setupVisible: true, safetyLevel: "safe", requiredForProduction: true });
    expect(provider).toMatchObject({ group: "providers", optionalInManualOnly: true });
    expect(ai).toMatchObject({ group: "ai", setupVisible: true });
    expect(listed.presets.openai).toContain("gpt-5.5");
    expect(listed.presets.gemini).toContain("gemini-2.5-pro");
  });
});

describe("admin config encryption and service", () => {
  it("encrypts without returning plaintext", async () => {
    const encrypted = await encryptSecretValue(hexKey, "hidden-value");
    expect(encrypted.ok).toBe(true);
    if (!encrypted.ok) return;
    expect(encrypted.value).not.toContain("hidden-value");
    const decrypted = await decryptSecretValue(hexKey, encrypted.value);
    expect(decrypted.ok).toBe(true);
    if (decrypted.ok) expect(decrypted.value).toBe("hidden-value");
  });

  it("saves non-secret config, D1 wins over env, and reset removes override", async () => {
    const e = env({ TELEGRAM_REAL_REVIEW_ENABLED: "false" });
    const saved = await setConfigValues(e, [{ key: "TELEGRAM_REAL_REVIEW_ENABLED", value: "true" }], request());
    expect(saved.ok).toBe(true);
    const effective = await getEffectiveEnv(e);
    expect(effective.TELEGRAM_REAL_REVIEW_ENABLED).toBe("true");
    const listed = await listEditableConfig(e);
    expect(listed.items.find((item) => item.key === "TELEGRAM_REAL_REVIEW_ENABLED")).toMatchObject({ value: "true", source: "d1" });
    const reset = await resetConfigValues(e, ["TELEGRAM_REAL_REVIEW_ENABLED"], request());
    expect(reset.ok).toBe(true);
    const afterEffective = await getEffectiveEnv(e);
    expect(afterEffective.TELEGRAM_REAL_REVIEW_ENABLED).toBe("false");
  });

  it("requires CONFIG_ENCRYPTION_KEY for secret saves and redacts audit", async () => {
    const missing = await setConfigValues(env(), [{ key: "FIRECRAWL_API_KEY", value: "hidden-value" }], request());
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error).toBe("missing_config_encryption_key");
    const e = env({ CONFIG_ENCRYPTION_KEY: hexKey });
    const saved = await setConfigValues(e, [{ key: "OPENAI_API_KEY", value: "hidden-value" }], request());
    expect(saved.ok).toBe(true);
    const listed = await listEditableConfig(e);
    const secret = listed.items.find((item) => item.key === "OPENAI_API_KEY");
    expect(secret).toMatchObject({ isSecret: true, configured: true, valueRedacted: "[configured]" });
    expect(JSON.stringify(listed)).not.toContain("hidden-value");
    const audit = await listAdminConfigAudit(e);
    expect(JSON.stringify(audit)).not.toContain("hidden-value");
    expect(audit.entries[0]).toMatchObject({ key: "OPENAI_API_KEY", new_value_redacted: "[redacted]" });
  });
});
