import { Badge, Button, Card, CardHeader, Input, Select, Switch, Textarea } from "../../shared/ui";
import type { AdminConfigItem, AdminConfigResponse } from "../../types";

export type SettingFilter = { groups?: string[]; keys?: string[]; keyIncludes?: string[]; excludeSecrets?: boolean };

export type SettingSaveState = "clean" | "dirty" | "saving" | "saved" | "saved_but_not_effective" | "failed";

type SettingsEditorProps = {
  items: AdminConfigItem[];
  drafts: Record<string, string>;
  setDrafts: (updater: (drafts: Record<string, string>) => Record<string, string>) => void;
  onSave: (item: AdminConfigItem) => Promise<void>;
  onReset: (item: AdminConfigItem) => Promise<void>;
  busy: string | undefined;
  saveStates?: Record<string, SettingSaveState>;
};

function isSecretSetting(item: AdminConfigItem): boolean { return item.isSecret === true; }
function isConfiguredSetting(item: AdminConfigItem): boolean { return item.configured === true; }
function isRequiredForProduction(item: AdminConfigItem): boolean { return item.requiredForProduction === true; }

export function SettingsEditor(props: SettingsEditorProps): JSX.Element {
  if (props.items.length === 0) return <Card><CardHeader title="No settings" description="No matching settings are available for this section." /></Card>;
  const groups = groupedSettings(props.items);
  return <div className="settings-grid">{Object.entries(groups).map(([group, items]) => <Card key={group}><CardHeader title={groupLabel(group)} description={`${items.length} editable setting${items.length === 1 ? "" : "s"}. Draft, effective value and source are shown separately.`} /><div className="setting-list">{items.map((item) => <SettingRow key={item.key} item={item} value={settingValue(item, props.drafts)} draftExists={props.drafts[item.key] !== undefined} saveState={props.saveStates?.[item.key]} onChange={(value) => props.setDrafts((drafts) => ({ ...drafts, [item.key]: value }))} onSave={() => void props.onSave(item)} onReset={() => void props.onReset(item)} busy={props.busy} />)}</div></Card>)}</div>;
}

function SettingRow({ item, value, draftExists, saveState, onChange, onSave, onReset, busy }: { item: AdminConfigItem; value: string; draftExists: boolean; saveState: SettingSaveState | undefined; onChange: (value: string) => void; onSave: () => void; onReset: () => void; busy: string | undefined }): JSX.Element {
  const saving = busy === `save-${item.key}` || busy === `reset-${item.key}`;
  const state: SettingSaveState = saving ? "saving" : saveState ?? (draftExists ? "dirty" : "clean");
  const effectiveValue = isSecretSetting(item) ? (isConfiguredSetting(item) ? "Configured, hidden" : "Missing") : item.value ?? item.valueRedacted ?? "";
  const draftLabel = isSecretSetting(item) ? (draftExists && value.length > 0 ? "New replacement entered" : "No replacement entered") : value;
  return <div className="setting-row"><div className="setting-copy"><div className="setting-title"><strong>{item.label}</strong><code>{item.key}</code></div><p>{item.description}</p><small>{item.whereUsed}</small><div className="setting-badges"><Badge tone={sourceTone(item.source)}>{item.source}</Badge><Badge tone={item.safetyLevel === "risky" ? "danger" : item.safetyLevel === "warning" ? "warning" : "success"}>{item.safetyLevel}</Badge>{isRequiredForProduction(item) && <Badge tone="warning">required for production</Badge>}{isSecretSetting(item) && <Badge tone={isConfiguredSetting(item) ? "success" : "warning"}>{isConfiguredSetting(item) ? "secret configured" : "secret missing"}</Badge>}<Badge tone={stateTone(state)}>{stateLabel(state)}</Badge></div><div className="setting-effective-grid"><span>Effective</span><strong>{effectiveValue || "empty"}</strong><span>Draft</span><strong>{draftLabel || "empty"}</strong>{state === "saved_but_not_effective" && <small className="warning-text">Saved override exists, but the effective value appears to still come from env/default.</small>}</div></div><div className="setting-control">{renderSettingControl(item, value, onChange)}<div className="button-row"><Button size="sm" onClick={onSave} disabled={saving || !item.editable || (isSecretSetting(item) && value.trim().length === 0)}>Save</Button><Button size="sm" variant="secondary" onClick={onReset} disabled={saving || !item.editable}>Reset override</Button></div></div></div>;
}

function renderSettingControl(item: AdminConfigItem, value: string, onChange: (value: string) => void): JSX.Element {
  if (item.type === "boolean") return <Switch label="Enabled" checked={value === "true"} onChange={(checked) => onChange(checked ? "true" : "false")} />;
  if (item.validation.enumValues && item.validation.enumValues.length > 0) return <Select label="Value" value={value} onChange={onChange} options={item.validation.enumValues.map((entry) => ({ value: entry, label: entry }))} />;
  if (isSecretSetting(item)) return <Input label="New secret value" type="password" value={value} onChange={onChange} placeholder={isConfiguredSetting(item) ? "Configured. Paste new value to replace." : "Paste secret value"} />;
  if (item.key === "AI_MODEL") return <Input label="Model ID" value={value} onChange={onChange} placeholder="gemini-2.5-flash or provider model id" />;
  if (item.key.includes("TIMEZONE")) return <Select label="Timezone" value={value || "Asia/Tehran"} onChange={onChange} options={["Asia/Tehran", "UTC", "Europe/London", "Europe/Sofia", "America/New_York"].map((entry) => ({ value: entry, label: entry }))} />;
  if (item.type === "integer" || item.type === "number") return <Input label="Value" type="number" value={value} onChange={onChange} />;
  if (item.type === "model_chain" || item.key.includes("PROMPT")) return <Textarea label="Value" value={value} onChange={onChange} rows={4} />;
  return <Input label="Value" value={value} onChange={onChange} />;
}

export function settingValue(item: AdminConfigItem, drafts: Record<string, string>): string {
  if (drafts[item.key] !== undefined) return drafts[item.key] ?? "";
  if (isSecretSetting(item)) return "";
  return item.value ?? "";
}

export function removeDraft(drafts: Record<string, string>, key: string): Record<string, string> { const next = { ...drafts }; delete next[key]; return next; }
export function findSetting(adminConfig: AdminConfigResponse | undefined, key: string): AdminConfigItem | undefined { return adminConfig?.items.find((item) => item.key === key); }

export function filterSettings(items: AdminConfigItem[], filter: SettingFilter): AdminConfigItem[] {
  return items.filter((item) => {
    if (filter.excludeSecrets && isSecretSetting(item)) return false;
    if (filter.groups && !filter.groups.includes(item.group)) return false;
    if (filter.keys && filter.keys.includes(item.key)) return true;
    if (filter.keyIncludes && filter.keyIncludes.some((fragment) => item.key.includes(fragment))) return true;
    return filter.groups !== undefined && filter.keyIncludes === undefined && filter.keys === undefined;
  });
}

export function groupedSettings(items: AdminConfigItem[]): Record<string, AdminConfigItem[]> {
  return items.reduce<Record<string, AdminConfigItem[]>>((groups, item) => { const group = item.group ?? "other"; groups[group] = [...(groups[group] ?? []), item]; return groups; }, {});
}

export function relatedSettingForIssue(issue: { code?: unknown; area?: unknown }): string {
  const code = typeof issue.code === "string" ? issue.code : "";
  const area = typeof issue.area === "string" ? issue.area : "";
  if (code.includes("scheduler")) return "TELEGRAM_PUBLISH_SCHEDULER_ENABLED";
  if (code.includes("prompt")) return "Prompt Studio";
  if (area === "media") return "Media Registry settings";
  if (area === "ai") return "AI provider secrets";
  if (area === "telegram") return "Telegram settings";
  return "Review related settings";
}

export function groupLabel(group: string): string { return group.split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" "); }
export function sourceTone(value: string): "success" | "warning" | "danger" | "info" | "muted" { if (value === "d1") return "success"; if (value === "env") return "info"; if (value === "missing") return "danger"; return "muted"; }
function stateTone(value: SettingSaveState): "success" | "warning" | "danger" | "info" | "muted" { if (value === "saved") return "success"; if (value === "dirty" || value === "saving" || value === "saved_but_not_effective") return "warning"; if (value === "failed") return "danger"; return "muted"; }
function stateLabel(value: SettingSaveState): string { if (value === "saved_but_not_effective") return "saved, not effective"; return value.replaceAll("_", " "); }
