import { ADMIN_CONFIG_DEFINITIONS, findAdminConfigDefinition, isEditableAdminConfigKey, isForbiddenAdminConfigKey, type AdminConfigDefinition, type AdminConfigGroup, type AdminConfigSafetyLevel, type AdminConfigSource } from "./allowlist";
import { decryptSecretValue, encryptSecretValue, importConfigEncryptionKey } from "./crypto";
import { validateAdminConfigValue } from "./validation";
import type { Env } from "../types";

export type AdminConfigRow = { key: string; value: string; value_type: string; is_secret: number; encrypted: number; updated_at: string; updated_by: string | null; description: string | null };
export type AdminConfigAuditRow = { id: string; key: string; value_type: string; is_secret: number; action: string; changed_at: string; changed_by: string | null; request_id: string | null; previous_value_redacted: string | null; new_value_redacted: string | null };
export type AdminConfigStoreStatus = { available: boolean; warning?: string };
export type SafeAdminConfigItem = { key: string; group: AdminConfigGroup; label: string; description: string; whereUsed: string; type: string; isSecret: boolean; editable: boolean; configured: boolean; source: AdminConfigSource; value?: string; valueRedacted?: string; safetyLevel: AdminConfigSafetyLevel; setupVisible: boolean; settingsVisible: boolean; requiredForProduction: boolean; optionalInManualOnly: boolean; validation: { enumValues?: string[]; min?: number; max?: number; maxLength?: number; maxItems?: number; preferHttps?: boolean }; updatedAt?: string; restartRequired: false };
export type SafeAdminConfigResponse = { ok: true; adminConfigStore: AdminConfigStoreStatus; encryption: { configured: boolean; valid: boolean; secretEditingEnabled: boolean; message?: string }; groups: Record<AdminConfigGroup, SafeAdminConfigItem[]>; items: SafeAdminConfigItem[]; presets: { openai: string[]; gemini: string[] }; modes: { key: string; label: string; description: string }[] };
export type SetAdminConfigInput = { key: string; value: unknown };
export type AdminConfigWriteResult = { ok: true; response: SafeAdminConfigResponse } | { ok: false; status: number; error: string; message: string };

type ReadAdminConfigRowsResult = { ok: true; rows: Map<string, AdminConfigRow>; store: AdminConfigStoreStatus } | { ok: false; rows: Map<string, AdminConfigRow>; store: AdminConfigStoreStatus };

export const AI_MODEL_PRESETS = { openai: ["gpt-5.5", "gpt-5.4", "gpt-5.4-mini", "gpt-5.4-nano"], gemini: ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.5-flash-lite"] };
export const OPERATING_MODE_DESCRIPTIONS = [
  { key: "manual_only", label: "Manual only", description: "I will add content manually. Provider credentials are not required." },
  { key: "mock_demo", label: "Mock/demo", description: "Use mock providers and mock E2E checks for demos and testing." },
  { key: "provider_assisted", label: "Provider-assisted", description: "Use configured providers such as Firecrawl, Apify, or GetXAPI when explicitly enabled." }
];

export async function listEditableConfig(env: Env): Promise<SafeAdminConfigResponse> {
  const stored = await readAdminConfigRows(env.DB);
  const encryption = await getEncryptionSummary(env);
  const items = ADMIN_CONFIG_DEFINITIONS.map((definition) => toSafeItem(definition, stored.rows.get(definition.key), env));
  return { ok: true, adminConfigStore: stored.store, encryption, groups: groupItems(items), items, presets: AI_MODEL_PRESETS, modes: OPERATING_MODE_DESCRIPTIONS };
}
export function getEditableConfigMetadata(): typeof ADMIN_CONFIG_DEFINITIONS { return ADMIN_CONFIG_DEFINITIONS; }
export async function getEffectiveEnv(env: Env): Promise<Env> { const stored = await readAdminConfigRows(env.DB); const effective = { ...env } as Env; for (const definition of ADMIN_CONFIG_DEFINITIONS) { const row = stored.rows.get(definition.key); if (row === undefined) continue; if (definition.isSecret) { const decrypted = await decryptSecretValue(env.CONFIG_ENCRYPTION_KEY, row.value); if (decrypted.ok && decrypted.kind === "decrypted") setEnvValue(effective, definition.key, decrypted.value); continue; } setEnvValue(effective, definition.key, row.value); } return effective; }
export async function getAdminConfigStoreStatus(env: Env): Promise<AdminConfigStoreStatus> { return (await readAdminConfigRows(env.DB)).store; }
export const getEffectiveConfig = getEffectiveEnv;
export const getConfigStatus = listEditableConfig;
export async function setConfigValue(env: Env, key: string, value: unknown, request: Request): Promise<AdminConfigWriteResult> { return setConfigValues(env, [{ key, value }], request); }

export async function setConfigValues(env: Env, updates: SetAdminConfigInput[], request: Request): Promise<AdminConfigWriteResult> {
  if (!hasD1(env.DB)) return { ok: false, status: 500, error: "admin_config_db_unavailable", message: "D1 admin config store is unavailable." };
  if (!Array.isArray(updates) || updates.length === 0) return { ok: false, status: 400, error: "empty_updates", message: "Provide at least one config update." };
  const stored = await readAdminConfigRows(env.DB);
  if (!stored.ok) return { ok: false, status: 500, error: "admin_config_store_unavailable", message: stored.store.warning ?? "Admin config store is unavailable." };
  const now = new Date().toISOString();
  const changedBy = request.headers.get("x-admin-user") ?? "dashboard";
  const requestId = request.headers.get("cf-ray") ?? request.headers.get("x-request-id") ?? crypto.randomUUID();
  for (const update of updates) {
    const definition = validateKey(update.key);
    if (!definition.ok) return definition;
    const validation = validateAdminConfigValue(definition.definition, update.value);
    if (!validation.ok) return { ok: false, status: 400, error: validation.error, message: validation.message };
    let valueToStore = validation.value;
    let encrypted = 0;
    if (definition.definition.isSecret) {
      const encryptedValue = await encryptSecretValue(env.CONFIG_ENCRYPTION_KEY, validation.value);
      if (!encryptedValue.ok) return { ok: false, status: 400, error: encryptedValue.error, message: encryptedValue.message };
      valueToStore = encryptedValue.value;
      encrypted = 1;
    }
    const previous = stored.rows.get(definition.definition.key);
    await env.DB.prepare(`INSERT INTO admin_config (key, value, value_type, is_secret, encrypted, updated_at, updated_by, description) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, value_type = excluded.value_type, is_secret = excluded.is_secret, encrypted = excluded.encrypted, updated_at = excluded.updated_at, updated_by = excluded.updated_by, description = excluded.description`).bind(definition.definition.key, valueToStore, definition.definition.valueType, definition.definition.isSecret ? 1 : 0, encrypted, now, changedBy, definition.definition.description).run();
    await writeAudit(env, { definition: definition.definition, action: previous === undefined ? "create" : "update", changedAt: now, changedBy, requestId, previousValueRedacted: redactedValue(definition.definition, previous?.value), newValueRedacted: redactedValue(definition.definition, validation.value) });
  }
  return { ok: true, response: await listEditableConfig(env) };
}

export async function resetConfigValue(env: Env, key: string, request: Request): Promise<AdminConfigWriteResult> { return resetConfigValues(env, [key], request); }
export async function resetConfigValues(env: Env, keys: string[], request: Request): Promise<AdminConfigWriteResult> { if (!hasD1(env.DB)) return { ok: false, status: 500, error: "admin_config_db_unavailable", message: "D1 admin config store is unavailable." }; if (!Array.isArray(keys) || keys.length === 0) return { ok: false, status: 400, error: "empty_keys", message: "Provide at least one config key to reset." }; const stored = await readAdminConfigRows(env.DB); if (!stored.ok) return { ok: false, status: 500, error: "admin_config_store_unavailable", message: stored.store.warning ?? "Admin config store is unavailable." }; const now = new Date().toISOString(); const changedBy = request.headers.get("x-admin-user") ?? "dashboard"; const requestId = request.headers.get("cf-ray") ?? request.headers.get("x-request-id") ?? crypto.randomUUID(); for (const key of keys) { const definition = validateKey(key); if (!definition.ok) return definition; const previous = stored.rows.get(key); await env.DB.prepare("DELETE FROM admin_config WHERE key = ?").bind(key).run(); await writeAudit(env, { definition: definition.definition, action: "reset", changedAt: now, changedBy, requestId, previousValueRedacted: redactedValue(definition.definition, previous?.value), newValueRedacted: "[reset]" }); } return { ok: true, response: await listEditableConfig(env) }; }
export async function listAdminConfigAudit(env: Env, limit = 50): Promise<{ ok: true; entries: AdminConfigAuditRow[]; adminConfigStore: AdminConfigStoreStatus }> { if (!hasD1(env.DB)) return { ok: true, entries: [], adminConfigStore: { available: false, warning: "D1 admin config store is unavailable." } }; const cappedLimit = Math.max(1, Math.min(Math.floor(limit), 100)); try { const result = await env.DB.prepare("SELECT * FROM admin_config_audit ORDER BY changed_at DESC LIMIT ?").bind(cappedLimit).all<AdminConfigAuditRow>(); return { ok: true, entries: result.results ?? [], adminConfigStore: { available: true } }; } catch { return { ok: true, entries: [], adminConfigStore: { available: false, warning: "Admin config audit table is missing or inaccessible. Apply D1 migrations before using audit history." } }; } }
export const getAuditLog = listAdminConfigAudit;
export async function getEncryptionSummary(env: Env): Promise<SafeAdminConfigResponse["encryption"]> { const imported = await importConfigEncryptionKey(env.CONFIG_ENCRYPTION_KEY); if (!imported.ok) return { configured: Boolean(env.CONFIG_ENCRYPTION_KEY), valid: false, secretEditingEnabled: false, message: imported.message }; return { configured: true, valid: true, secretEditingEnabled: true }; }

function validateKey(key: string): { ok: true; definition: AdminConfigDefinition } | { ok: false; status: 400; error: string; message: string } { if (typeof key !== "string") return { ok: false, status: 400, error: "invalid_key", message: "Config key must be a string." }; if (isForbiddenAdminConfigKey(key) || !isEditableAdminConfigKey(key)) return { ok: false, status: 400, error: "config_key_not_editable", message: `${key} is not editable from the dashboard.` }; const definition = findAdminConfigDefinition(key); return definition === undefined ? { ok: false, status: 400, error: "unknown_config_key", message: `${key} is not allowed.` } : { ok: true, definition }; }
async function readAdminConfigRows(db: D1Database): Promise<ReadAdminConfigRowsResult> { if (!hasD1(db)) return { ok: false, rows: new Map(), store: { available: false, warning: "D1 admin config store is unavailable." } }; try { const result = await db.prepare("SELECT * FROM admin_config").all<AdminConfigRow>(); return { ok: true, rows: new Map((result.results ?? []).map((row) => [row.key, row])), store: { available: true } }; } catch { return { ok: false, rows: new Map(), store: { available: false, warning: "Admin config table is missing or inaccessible. Apply D1 migrations before using dashboard overrides." } }; } }
function hasD1(db: D1Database): boolean { return typeof (db as unknown as { prepare?: unknown }).prepare === "function"; }
function toSafeItem(definition: AdminConfigDefinition, row: AdminConfigRow | undefined, env: Env): SafeAdminConfigItem { const envValue = readEnvValue(env, definition.key); const defaultValue = definition.defaultValue; const source: AdminConfigSource = row !== undefined ? "d1" : envValue !== undefined ? "env" : defaultValue !== undefined ? "default" : "missing"; const configured = row !== undefined || envValue !== undefined || defaultValue !== undefined; const rawValue = row?.value ?? envValue ?? defaultValue ?? ""; const safeValue = definition.valueType === "model_chain" ? normalizeModelChainForRead(rawValue) : rawValue; const validation = { ...(definition.enumValues === undefined ? {} : { enumValues: [...definition.enumValues] }), ...(definition.min === undefined ? {} : { min: definition.min }), ...(definition.max === undefined ? {} : { max: definition.max }), ...(definition.maxLength === undefined ? {} : { maxLength: definition.maxLength }), ...(definition.maxItems === undefined ? {} : { maxItems: definition.maxItems }), ...(definition.preferHttps === undefined ? {} : { preferHttps: definition.preferHttps }) }; const base = { key: definition.key, group: definition.group, label: definition.label, description: definition.description, whereUsed: definition.whereUsed, type: definition.valueType, isSecret: definition.isSecret, editable: definition.editable, configured, source, safetyLevel: definition.safetyLevel, setupVisible: definition.setupVisible, settingsVisible: definition.settingsVisible, requiredForProduction: definition.requiredForProduction, optionalInManualOnly: definition.optionalInManualOnly, restartRequired: false as const, validation, ...(row === undefined ? {} : { updatedAt: row.updated_at }) }; if (definition.isSecret) return { ...base, valueRedacted: configured ? "[configured]" : "[missing]" }; return { ...base, value: safeValue }; }
function normalizeModelChainForRead(value: string): string { const definition = findAdminConfigDefinition("AI_MODEL_FALLBACKS"); if (definition === undefined) return "[]"; const validation = validateAdminConfigValue(definition, value); return validation.ok ? validation.value : "[]"; }
function groupItems(items: SafeAdminConfigItem[]): Record<AdminConfigGroup, SafeAdminConfigItem[]> { return { operating_mode: items.filter((item) => item.group === "operating_mode"), content_input: items.filter((item) => item.group === "content_input"), ai: items.filter((item) => item.group === "ai"), telegram: items.filter((item) => item.group === "telegram"), wordpress: items.filter((item) => item.group === "wordpress"), providers: items.filter((item) => item.group === "providers"), scheduler: items.filter((item) => item.group === "scheduler"), quotas: items.filter((item) => item.group === "quotas") }; }
async function writeAudit(env: Env, input: { definition: AdminConfigDefinition; action: string; changedAt: string; changedBy: string; requestId: string; previousValueRedacted: string; newValueRedacted: string }): Promise<void> { await env.DB.prepare(`INSERT INTO admin_config_audit (id, key, value_type, is_secret, action, changed_at, changed_by, request_id, previous_value_redacted, new_value_redacted) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(crypto.randomUUID(), input.definition.key, input.definition.valueType, input.definition.isSecret ? 1 : 0, input.action, input.changedAt, input.changedBy, input.requestId, input.previousValueRedacted, input.newValueRedacted).run(); }
function redactedValue(definition: AdminConfigDefinition, value: string | undefined): string { if (value === undefined) return "[missing]"; return definition.isSecret ? "[redacted]" : definition.valueType === "model_chain" ? normalizeModelChainForRead(value) : value; }
function readEnvValue(env: Env, key: string): string | undefined { const value = (env as unknown as Record<string, string | undefined>)[key]; return typeof value === "string" && value.trim().length > 0 ? value : undefined; }
function setEnvValue(env: Env, key: string, value: string): void { (env as unknown as Record<string, string | undefined>)[key] = value; }
