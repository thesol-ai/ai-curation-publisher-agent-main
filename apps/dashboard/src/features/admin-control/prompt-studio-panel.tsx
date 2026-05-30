import { useMemo, useState } from "react";
import { Alert, Badge, Button, Card, CardHeader, DataTable, Input, Select, Textarea } from "../../shared/ui";
import type { JsonObject } from "../../types";
import { readBoolean, readString } from "./dashboard-utils";
import { SimplePromptEditor } from "./category-wizard";

export type PromptProfileForm = { id: string; name: string; category: string; language: string; contentType: string; version: string; status: string; systemPrompt: string; userPromptTemplate: string; modelHint: string; temperature: string; maxTokens: string; riskPolicy: string; styleGuide: string; negativePrompt: string };
export type PromptBindingForm = { routeId: string; routeOutputId: string; category: string; language: string; promptProfileId: string; contentType: string };

type Props = {
  profiles: JsonObject[];
  bindings: JsonObject[];
  runs: JsonObject[];
  routes?: JsonObject[];
  outputs?: JsonObject[];
  promptStudio: JsonObject | undefined;
  promptForm: PromptProfileForm;
  setPromptForm: (value: PromptProfileForm) => void;
  bindingForm: PromptBindingForm;
  setBindingForm: (value: PromptBindingForm) => void;
  promptPreview: JsonObject | undefined;
  onSavePrompt: () => Promise<void>;
  onActivatePrompt: (profileId: string) => Promise<void>;
  onArchivePrompt: (profileId: string) => Promise<void>;
  onSaveBinding: () => Promise<void>;
  onPreviewPrompt: () => Promise<void>;
  onUpsertSimplePrompt: (input: JsonObject) => Promise<void>;
  busy: string | undefined;
};

export function PromptStudioPanel(props: Props): JSX.Element {
  const [selectedOutputId, setSelectedOutputId] = useState(readString(props.outputs?.[0], "id") ?? "");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showDiff, setShowDiff] = useState(false);
  const updatePrompt = (patch: Partial<PromptProfileForm>): void => props.setPromptForm({ ...props.promptForm, ...patch });
  const updateBinding = (patch: Partial<PromptBindingForm>): void => props.setBindingForm({ ...props.bindingForm, ...patch });
  const variables = readStringArray(props.promptStudio, "templateVariables");
  const selectedOutput = props.outputs?.find((output) => readString(output, "id") === selectedOutputId) ?? props.outputs?.[0];
  const selectedRoute = props.routes?.find((route) => readString(route, "id") === readString(selectedOutput, "routeId"));
  const selectedBinding = props.bindings.find((binding) => readString(binding, "routeOutputId") === readString(selectedOutput, "id"));
  const promptOptions = props.profiles.map((profile) => ({ value: readString(profile, "id") ?? "", label: `${readString(profile, "id") ?? "unknown"} · ${readString(profile, "status") ?? "draft"}` })).filter((option) => option.value.length > 0);
  const outputOptions = (props.outputs ?? []).map((output) => ({ value: readString(output, "id") ?? "", label: `${readString(output, "id") ?? "output"} · ${readString(output, "language") ?? "lang"}` })).filter((option) => option.value.length > 0);
  const activePromptMap = buildActivePromptMap(props.outputs ?? [], props.bindings, props.profiles);
  const libraryRows = props.profiles.map((profile) => ({ ...profile, usedBy: props.bindings.filter((binding) => readString(binding, "promptProfileId") === readString(profile, "id")).map((binding) => readString(binding, "routeOutputId") ?? readString(binding, "routeId") ?? "global").join(", ") || "not bound" }));
  const diff = useMemo(() => buildPromptDiff(props.profiles[0], props.profiles[1]), [props.profiles]);

  if (!showAdvanced) {
    return <div className="page-grid">
      <Card className="hero-card"><CardHeader eyebrow="Simple Prompt Manager" title="Set prompts by category and language" description="Daily mode: pick a category/language output, edit prompt settings, and save. The dashboard creates the profile and binding automatically." action={<Button variant="secondary" onClick={() => setShowAdvanced(true)}>Advanced Prompt Studio</Button>} /><Alert title="No raw IDs needed" tone="info">You do not need to type routeOutputId, promptProfileId, binding, version, or status in simple mode.</Alert></Card>
      <SimplePromptEditor title="Prompt by category/language" description="Edit only the fields you care about: prompt text, template, negative prompt, temperature, max tokens, risk policy and style guide." routes={props.routes ?? []} outputs={props.outputs ?? []} profiles={props.profiles} bindings={props.bindings} busy={props.busy} onUpsertPrompt={props.onUpsertSimplePrompt} />
      <Card><CardHeader title="Prompt map" description="Every output should have one connected prompt." /><DataTable rows={activePromptMap} columns={[{ key: "category", label: "Category" }, { key: "language", label: "Lang" }, { key: "routeOutputId", label: "Output" }, { key: "promptProfileId", label: "Active prompt" }, { key: "status", label: "Status", render: (row) => <Badge tone={readString(row, "status") === "bound" ? "success" : "warning"}>{readString(row, "status")}</Badge> }]} /></Card>
    </div>;
  }

  return <div className="page-grid">
    <Card className="hero-card"><CardHeader eyebrow="Prompt Studio V3" title="Route/output-first prompt management" description="Choose the output first, then edit, bind, preview, activate and audit prompts in the right category/language context." action={<Button variant="secondary" onClick={() => setShowAdvanced(false)}>Simple mode</Button>} /><div className="prompt-variable-grid">{variables.map((variable) => <Badge key={variable} tone="info">{`{{${variable}}}`}</Badge>)}</div><Alert title="Context first" tone="info">Prompt changes only affect live Telegram workflow when an enabled binding connects the prompt to a route output.</Alert></Card>

    <Card><CardHeader title="Prompt context" description="This is the exact category/output/language context affected by prompt bindings." /><div className="grid two"><Select label="Route output" value={selectedOutputId} onChange={setSelectedOutputId} options={outputOptions.length > 0 ? outputOptions : [{ value: "", label: "No outputs configured" }]} /><Input label="Route" value={readString(selectedOutput, "routeId") ?? ""} onChange={() => undefined} /><Input label="Category" value={readString(selectedOutput, "category") ?? readString(selectedRoute, "category") ?? ""} onChange={() => undefined} /><Input label="Language" value={readString(selectedOutput, "language") ?? ""} onChange={() => undefined} /></div><div className="context-summary"><Badge tone={selectedBinding ? "success" : "warning"}>{selectedBinding ? "binding active" : "binding missing"}</Badge><strong>Active prompt: {readString(selectedBinding, "promptProfileId") ?? "missing"}</strong>{!selectedBinding && <Button size="sm" variant="secondary" onClick={() => { updateBinding({ routeId: readString(selectedOutput, "routeId") ?? "", routeOutputId: readString(selectedOutput, "id") ?? "", category: readString(selectedOutput, "category") ?? readString(selectedRoute, "category") ?? "", language: readString(selectedOutput, "language") ?? "fa" }); }}>Prefill binding</Button>}</div></Card>

    <Card><CardHeader title="Active prompt map" description="Every output should have one clear active binding." /><DataTable rows={activePromptMap} columns={[{ key: "category", label: "Category" }, { key: "language", label: "Lang" }, { key: "routeOutputId", label: "Output" }, { key: "promptProfileId", label: "Active prompt" }, { key: "status", label: "Status", render: (row) => <Badge tone={readString(row, "status") === "bound" ? "success" : "warning"}>{readString(row, "status")}</Badge> }]} /></Card>

    <Card><CardHeader title="Prompt editor" description="Create or update a managed prompt profile. Active prompts can be rolled back by activating an older version." /><div className="grid two"><Input label="Prompt ID" value={props.promptForm.id} onChange={(value) => updatePrompt({ id: value })} /><Input label="Name" value={props.promptForm.name} onChange={(value) => updatePrompt({ name: value })} /><Input label="Category" value={props.promptForm.category} onChange={(value) => updatePrompt({ category: value })} /><Input label="Language" value={props.promptForm.language} onChange={(value) => updatePrompt({ language: value })} /><Input label="Version" value={props.promptForm.version} onChange={(value) => updatePrompt({ version: value })} /><Select label="Status" value={props.promptForm.status} onChange={(value) => updatePrompt({ status: value })} options={[{ value: "draft", label: "Draft" }, { value: "active", label: "Active" }, { value: "archived", label: "Archived" }]} /></div>{props.promptForm.status !== "active" && <Alert title="Draft warning" tone="warning">You are editing a draft. It will not affect live Telegram reviews until it is activated and bound to an output.</Alert>}<Textarea label="System prompt" value={props.promptForm.systemPrompt} onChange={(value) => updatePrompt({ systemPrompt: value })} rows={7} /><Textarea label="User prompt template" value={props.promptForm.userPromptTemplate} onChange={(value) => updatePrompt({ userPromptTemplate: value })} rows={9} /><Textarea label="Negative prompt" value={props.promptForm.negativePrompt} onChange={(value) => updatePrompt({ negativePrompt: value })} rows={3} /><div className="grid two"><Input label="Model hint" value={props.promptForm.modelHint} onChange={(value) => updatePrompt({ modelHint: value })} /><Input label="Temperature" value={props.promptForm.temperature} onChange={(value) => updatePrompt({ temperature: value })} /><Input label="Max tokens" value={props.promptForm.maxTokens} onChange={(value) => updatePrompt({ maxTokens: value })} /><Input label="Content type" value={props.promptForm.contentType} onChange={(value) => updatePrompt({ contentType: value })} /></div><Textarea label="Risk policy" value={props.promptForm.riskPolicy} onChange={(value) => updatePrompt({ riskPolicy: value })} rows={3} /><Textarea label="Style guide" value={props.promptForm.styleGuide} onChange={(value) => updatePrompt({ styleGuide: value })} rows={3} /><div className="button-row"><Button onClick={() => void props.onSavePrompt()} disabled={props.busy !== undefined}>Save prompt</Button><Button variant="secondary" onClick={() => void props.onPreviewPrompt()} disabled={props.busy !== undefined}>Preview</Button></div>{props.promptPreview && <PromptPreviewResult value={props.promptPreview} />}</Card>

    <Card><CardHeader title="Prompt library" description="Active prompts can be bound to route outputs. Drafts are safe until activated." /><DataTable rows={libraryRows} columns={[{ key: "id", label: "ID" }, { key: "name", label: "Name" }, { key: "category", label: "Category" }, { key: "language", label: "Language" }, { key: "version", label: "Version" }, { key: "usedBy", label: "Used by" }, { key: "status", label: "Status", render: (row) => <Badge tone={readString(row, "status") === "active" ? "success" : readString(row, "status") === "archived" ? "muted" : "warning"}>{readString(row, "status") ?? "draft"}</Badge> }, { key: "action", label: "Action", render: (row) => <div className="inline-actions"><Button size="sm" variant="secondary" onClick={() => void props.onActivatePrompt(readString(row, "id") ?? "")}>Activate / Roll back</Button><Button size="sm" variant="ghost" onClick={() => void props.onArchivePrompt(readString(row, "id") ?? "")}>Archive</Button></div> }]} /></Card>

    <Card><CardHeader title="Prompt binding" description="Binding is the link that makes a prompt affect a live route output." /><div className="grid two"><Input label="Route ID" value={props.bindingForm.routeId} onChange={(value) => updateBinding({ routeId: value })} /><Input label="Route output ID" value={props.bindingForm.routeOutputId} onChange={(value) => updateBinding({ routeOutputId: value })} /><Input label="Category" value={props.bindingForm.category} onChange={(value) => updateBinding({ category: value })} /><Input label="Language" value={props.bindingForm.language} onChange={(value) => updateBinding({ language: value })} /><Select label="Prompt profile" value={props.bindingForm.promptProfileId} onChange={(value) => updateBinding({ promptProfileId: value })} options={promptOptions.length > 0 ? promptOptions : [{ value: props.bindingForm.promptProfileId, label: props.bindingForm.promptProfileId || "No prompts" }]} /><Input label="Content type" value={props.bindingForm.contentType} onChange={(value) => updateBinding({ contentType: value })} /></div><Button onClick={() => void props.onSaveBinding()} disabled={props.busy !== undefined}>Save binding</Button><DataTable rows={props.bindings} columns={[{ key: "routeOutputId", label: "Output" }, { key: "routeId", label: "Route" }, { key: "category", label: "Category" }, { key: "language", label: "Language" }, { key: "promptProfileId", label: "Prompt" }, { key: "enabled", label: "Status", render: (row) => <Badge tone={readBoolean(row, "enabled") === false ? "muted" : "success"}>{readBoolean(row, "enabled") === false ? "Disabled" : "Enabled"}</Badge> }]} /></Card>

    <Card><CardHeader title="Advanced visual diff" description="Collapsed by default because same-line walls are noise. Use it only for detailed version comparison." action={<Button size="sm" variant="secondary" onClick={() => setShowDiff(!showDiff)}>{showDiff ? "Hide diff" : "Show diff"}</Button>} />{showDiff && <PromptDiffViewer rows={diff} />}</Card>
    <Card><CardHeader title="Prompt run history" description="Recent previews and future real prompt executions. Empty history means backend run logging has not produced records yet." /><DataTable rows={props.runs} columns={[{ key: "id", label: "Run" }, { key: "promptProfileId", label: "Prompt" }, { key: "promptVersion", label: "Version" }, { key: "provider", label: "Provider" }, { key: "model", label: "Model" }, { key: "status", label: "Status", render: (row) => <Badge tone={readString(row, "status") === "failed" ? "danger" : "info"}>{readString(row, "status") ?? "unknown"}</Badge> }, { key: "createdAt", label: "Created" }, { key: "errorMessage", label: "Error" }]} /></Card>
  </div>;
}

function PromptPreviewResult({ value }: { value: JsonObject }): JSX.Element {
  return <div className="prompt-preview-grid"><div><strong>Raw / backend response</strong><pre>{JSON.stringify(value, null, 2)}</pre></div><div><strong>Validation checklist</strong><ul><li>Rendered prompt returned: {readString(value, "rendered") ? "yes" : "check response"}</li><li>Parsed output: backend dependent</li><li>Fallback used: backend dependent</li><li>Final Telegram caption: backend dependent</li></ul></div></div>;
}

function buildActivePromptMap(outputs: JsonObject[], bindings: JsonObject[], profiles: JsonObject[]): JsonObject[] {
  return outputs.map((output) => {
    const binding = bindings.find((entry) => readString(entry, "routeOutputId") === readString(output, "id") || (readString(entry, "routeId") === readString(output, "routeId") && readString(entry, "language") === readString(output, "language")));
    const prompt = profiles.find((profile) => readString(profile, "id") === readString(binding, "promptProfileId"));
    return { category: readString(output, "category") ?? readString(binding, "category") ?? "-", language: readString(output, "language") ?? "-", routeOutputId: readString(output, "id") ?? "-", promptProfileId: readString(binding, "promptProfileId") ?? "missing", promptStatus: readString(prompt, "status") ?? "missing", status: binding ? "bound" : "missing" };
  });
}

function PromptDiffViewer({ rows }: { rows: Array<{ kind: "same" | "added" | "removed"; text: string }> }): JSX.Element {
  const changed = rows.filter((row) => row.kind !== "same");
  const visibleRows = changed.length > 0 ? changed : rows.slice(0, 20);
  if (rows.length === 0) return <div className="ui-empty">Select two prompt versions to compare.</div>;
  return <div className="prompt-diff">{visibleRows.map((row, index) => <div key={`${row.kind}-${index}`} className={`prompt-diff-line prompt-diff-${row.kind}`}><Badge tone={row.kind === "added" ? "success" : row.kind === "removed" ? "danger" : "muted"}>{row.kind}</Badge><code>{row.text || " "}</code></div>)}</div>;
}

function buildPromptDiff(base: JsonObject | undefined, compare: JsonObject | undefined): Array<{ kind: "same" | "added" | "removed"; text: string }> {
  if (!base || !compare) return [];
  const baseLines = promptText(base).split("\n");
  const compareLines = promptText(compare).split("\n");
  const max = Math.max(baseLines.length, compareLines.length);
  const rows: Array<{ kind: "same" | "added" | "removed"; text: string }> = [];
  for (let index = 0; index < max; index += 1) {
    const left = baseLines[index];
    const right = compareLines[index];
    if (left === right && left !== undefined) rows.push({ kind: "same", text: left });
    else {
      if (left !== undefined) rows.push({ kind: "removed", text: left });
      if (right !== undefined) rows.push({ kind: "added", text: right });
    }
  }
  return rows;
}

function promptText(profile: JsonObject): string { return ["# System", readString(profile, "systemPrompt") ?? "", "", "# User", readString(profile, "userPromptTemplate") ?? ""].join("\n"); }
function readStringArray(value: unknown, key: string): string[] { const object = typeof value === "object" && value !== null && !Array.isArray(value) ? value as JsonObject : undefined; const raw = object?.[key]; return Array.isArray(raw) ? raw.filter((entry): entry is string => typeof entry === "string") : []; }
