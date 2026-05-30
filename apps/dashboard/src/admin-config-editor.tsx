import { useMemo, useState } from "react";
import type { AdminConfigGroup, AdminConfigItem, AdminConfigResponse } from "./types";

export type AdminConfigEditorProps = {
  config: AdminConfigResponse | undefined;
  activeGroup: AdminConfigGroup;
  busy: boolean;
  onSave: (key: string, value: string) => Promise<void>;
  onReset: (key: string) => Promise<void>;
};

export const ADMIN_CONFIG_GROUP_LABELS: Record<AdminConfigGroup, string> = {
  operating_mode: "Operating mode",
  content_input: "Content input",
  ai: "AI",
  telegram: "Telegram",
  wordpress: "WordPress",
  providers: "Providers",
  scheduler: "Scheduler",
  quotas: "Quotas"
};

export function adminConfigGroupOrder(): AdminConfigGroup[] {
  return ["operating_mode", "content_input", "ai", "telegram", "wordpress", "providers", "scheduler", "quotas"];
}

export function initialDraftValue(item: AdminConfigItem): string {
  if (item.isSecret) return "";
  return item.value ?? "";
}

export function inputTypeForItem(item: AdminConfigItem): "select" | "checkbox" | "number" | "password" | "text" {
  if (item.isSecret) return "password";
  if (item.validation.enumValues !== undefined && item.validation.enumValues.length > 0) return "select";
  if (item.type === "boolean") return "checkbox";
  if (item.type === "integer" || item.type === "number") return "number";
  return "text";
}

export function safeConfiguredLabel(item: AdminConfigItem): string {
  if (item.isSecret) return item.configured ? "Configured, value hidden" : "Missing";
  if (item.valueRedacted !== undefined && item.valueRedacted.length > 0) return item.valueRedacted;
  if (item.value !== undefined && item.value.length > 0) return item.value;
  return item.configured ? "Configured" : "Missing";
}

export function AdminConfigEditor({ config, activeGroup, busy, onSave, onReset }: AdminConfigEditorProps): JSX.Element {
  const items = useMemo(() => config?.groups[activeGroup]?.filter((item) => item.settingsVisible) ?? [], [config, activeGroup]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  if (config === undefined) {
    return <div className="emptyState"><h3>Settings not loaded</h3><p>Enter Admin access, then load settings. The editor uses protected admin config and never shows secret values.</p></div>;
  }

  if (items.length === 0) {
    return <div className="emptyState"><h3>No editable settings in this group</h3><p>This group has no visible settings for the current mode.</p></div>;
  }

  return (
    <div className="wizardContent">
      <div className="callout neutralSoft">
        <strong>{ADMIN_CONFIG_GROUP_LABELS[activeGroup]}</strong>
        <span>Editable settings are loaded from protected admin config. Secret values are never displayed.</span>
      </div>
      {items.map((item) => {
        const draft = drafts[item.key] ?? initialDraftValue(item);
        const inputType = inputTypeForItem(item);
        const canSave = item.editable && (!item.isSecret || draft.trim().length > 0);
        return (
          <article className="panel" key={item.key}>
            <div className="cardHeader">
              <span className={`badge ${item.safetyLevel === "safe" ? "safe" : item.safetyLevel === "warning" ? "warning" : "danger"}`}>{item.safetyLevel}</span>
              <h3>{item.label}</h3>
            </div>
            <p>{item.description}</p>
            <p className="muted">Technical name: <code>{item.key}</code></p>
            <p className="muted">Used in: {item.whereUsed}</p>
            <div className="grid two">
              <span>Source: {item.source}</span>
              <span>Status: {safeConfiguredLabel(item)}</span>
              <span>Production: {item.requiredForProduction ? "Required" : "Optional"}</span>
              <span>Manual-only: {item.optionalInManualOnly ? "Optional" : "Relevant"}</span>
            </div>
            {item.editable ? (
              <div className="wizardContent">
                {inputType === "select" && (
                  <label>
                    Value
                    <select value={draft} onChange={(event) => setDrafts({ ...drafts, [item.key]: event.target.value })}>
                      <option value="">Select…</option>
                      {item.validation.enumValues?.map((value) => <option key={value} value={value}>{value}</option>)}
                    </select>
                  </label>
                )}
                {inputType === "checkbox" && (
                  <label className="checkRow">
                    <input type="checkbox" checked={draft === "true"} onChange={(event) => setDrafts({ ...drafts, [item.key]: event.target.checked ? "true" : "false" })} />
                    Enabled
                  </label>
                )}
                {inputType === "number" && (
                  <label>
                    Value
                    <input type="number" value={draft} min={item.validation.min} max={item.validation.max} onChange={(event) => setDrafts({ ...drafts, [item.key]: event.target.value })} />
                  </label>
                )}
                {inputType === "password" && (
                  <label>
                    New secret value
                    <input type="password" value={draft} placeholder={item.configured ? "Configured, enter only to replace" : "Missing"} onChange={(event) => setDrafts({ ...drafts, [item.key]: event.target.value })} />
                  </label>
                )}
                {inputType === "text" && (
                  <label>
                    Value
                    <input value={draft} maxLength={item.validation.maxLength} onChange={(event) => setDrafts({ ...drafts, [item.key]: event.target.value })} />
                  </label>
                )}
                <div className="buttonRow">
                  <button type="button" disabled={busy || !canSave} onClick={() => void onSave(item.key, draft)}>Save</button>
                  <button type="button" className="secondary" disabled={busy || !item.editable} onClick={() => void onReset(item.key)}>Reset</button>
                </div>
              </div>
            ) : <p className="muted">This setting is read-only in the dashboard.</p>}
          </article>
        );
      })}
    </div>
  );
}
