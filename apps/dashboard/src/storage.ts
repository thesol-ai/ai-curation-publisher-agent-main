import type { DashboardSettings, OperationRecord } from "./types";

const apiBaseUrlKey = "curator.dashboard.apiBaseUrl";
const internalCredentialSessionKey = "curator.dashboard.internalCredential.session.v2";
const oldInternalCredentialSessionKey = "curator.dashboard.internalCredential.session";
const oldInternalCredentialLocalKey = "curator.dashboard.internalCredential.local";
const rememberInternalCredentialKey = "curator.dashboard.rememberInternalCredential";
const operationHistoryKey = "curator.dashboard.operationHistory";

let inMemoryInternalCredential: string | undefined;

export function loadSettings(): DashboardSettings {
  const apiBaseUrl = globalThis.localStorage?.getItem(apiBaseUrlKey) ?? "";
  removeLegacyStoredCredential();

  return {
    apiBaseUrl,
    hasInternalCredential: getInternalCredential() !== undefined,
    rememberInternalCredential: true
  };
}

export function saveApiBaseUrl(value: string): void {
  globalThis.localStorage?.setItem(apiBaseUrlKey, value.trim());
}

export function saveInternalCredential(value: string, _remember: boolean): void {
  removeLegacyStoredCredential();
  const trimmed = value.trim();
  inMemoryInternalCredential = trimmed.length === 0 ? undefined : trimmed;
  if (trimmed.length === 0) {
    removeSessionCredential();
    return;
  }
  try {
    globalThis.sessionStorage?.setItem(internalCredentialSessionKey, trimmed);
  } catch {
    // Session persistence is a convenience only. In-memory auth still works if storage is blocked.
  }
}

export function getInternalCredential(): string | undefined {
  if (inMemoryInternalCredential !== undefined) return inMemoryInternalCredential;
  try {
    const stored = globalThis.sessionStorage?.getItem(internalCredentialSessionKey)?.trim();
    inMemoryInternalCredential = stored && stored.length > 0 ? stored : undefined;
  } catch {
    inMemoryInternalCredential = undefined;
  }
  return inMemoryInternalCredential;
}

export function clearInternalCredential(): void {
  inMemoryInternalCredential = undefined;
  removeSessionCredential();
  removeLegacyStoredCredential();
}

export function clearSettings(): void {
  globalThis.localStorage?.removeItem(apiBaseUrlKey);
  clearInternalCredential();
}

export function loadOperationHistory(): OperationRecord[] {
  const raw = globalThis.localStorage?.getItem(operationHistoryKey);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as OperationRecord[];
    return Array.isArray(parsed) ? parsed.slice(0, 10) : [];
  } catch {
    return [];
  }
}

export function saveOperationRecord(record: OperationRecord): OperationRecord[] {
  const next = [record, ...loadOperationHistory()].slice(0, 10);
  globalThis.localStorage?.setItem(operationHistoryKey, JSON.stringify(next));
  return next;
}

export function clearOperationHistory(): void {
  globalThis.localStorage?.removeItem(operationHistoryKey);
}

function removeSessionCredential(): void {
  try {
    globalThis.sessionStorage?.removeItem(internalCredentialSessionKey);
  } catch {
    // Ignore storage cleanup failures.
  }
}

function removeLegacyStoredCredential(): void {
  globalThis.sessionStorage?.removeItem(oldInternalCredentialSessionKey);
  globalThis.localStorage?.removeItem(oldInternalCredentialLocalKey);
  globalThis.localStorage?.removeItem(rememberInternalCredentialKey);
}
