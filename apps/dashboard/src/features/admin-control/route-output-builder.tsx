import { useEffect, useMemo, useState } from "react";
import { Alert, Badge, Button, Card, CardHeader, DataTable, Input, Select, Switch, Textarea } from "../../shared/ui";
import type { JsonObject } from "../../types";
import { readBoolean, readNumber, readString } from "./dashboard-utils";
import { OutputMatrix, topicLabel } from "./category-topology";

type RouteDraft = { id: string; category: string; sourceChatId: string; sourceThreadId: string; promptProfile: string; enabled: boolean };
type OutputDraft = { id: string; routeId: string; language: string; reviewChatId: string; reviewThreadId: string; finalChatId: string; finalThreadId: string; publishEnabled: boolean; publishMode: string; timezone: string; allowedPublishWindows: string; minimumGapMinutes: string; maxPostsPerHour: string; maxPostsPerDay: string; queuePriority: string; signatureEnabled: boolean; signatureText: string; signatureChannelHandle: string; signaturePosition: string };

const emptyRoute: RouteDraft = { id: "", category: "", sourceChatId: "", sourceThreadId: "", promptProfile: "crypto_editorial", enabled: true };
const emptyOutput: OutputDraft = { id: "", routeId: "", language: "fa", reviewChatId: "", reviewThreadId: "", finalChatId: "", finalThreadId: "", publishEnabled: true, publishMode: "queued", timezone: "Asia/Tehran", allowedPublishWindows: "", minimumGapMinutes: "10", maxPostsPerHour: "4", maxPostsPerDay: "24", queuePriority: "100", signatureEnabled: false, signatureText: "", signatureChannelHandle: "", signaturePosition: "append" };

const languages = [{ value: "fa", label: "Persian / fa" }, { value: "en", label: "English / en" }, { value: "ar", label: "Arabic / ar" }, { value: "auto", label: "Auto" }];
const timezones = ["Asia/Tehran", "UTC", "Europe/Sofia", "Europe/London", "America/New_York"];
const gapPresets = [{ value: "1", label: "1m test" }, { value: "10", label: "10m normal" }, { value: "30", label: "30m low volume" }, { value: "60", label: "60m conservative" }];
const hourlyPresets = ["1", "2", "4", "10", "60"].map((value) => ({ value, label: value === "60" ? "60 test" : value }));

type Props = {
  routes: JsonObject[];
  outputs: JsonObject[];
  promptProfiles?: JsonObject[];
  bindings?: JsonObject[];
  issues?: JsonObject[];
  busy: string | undefined;
  categoryScope?: string;
  onSaveRoute: (route: JsonObject, existing: boolean) => Promise<void>;
  onDisableRoute: (routeId: string) => Promise<void>;
  onSaveOutput: (routeId: string, output: JsonObject, existing: boolean) => Promise<void>;
  onDisableOutput: (outputId: string) => Promise<void>;
};

export function RouteOutputBuilder(props: Props): JSX.Element {
  const [routeDraft, setRouteDraft] = useState<RouteDraft>(emptyRoute);
  const [outputDraft, setOutputDraft] = useState<OutputDraft>(emptyOutput);

  const existingRouteIds = useMemo(() => new Set(props.routes.map((route) => readString(route, "id")).filter(Boolean) as string[]), [props.routes]);
  const existingOutputIds = useMemo(() => new Set(props.outputs.map((output) => readString(output, "id")).filter(Boolean) as string[]), [props.outputs]);
  const categories = useMemo(() => Array.from(new Set(props.routes.map((route) => readString(route, "category") ?? "crypto"))).sort(), [props.routes]);
  const routeOptions = props.routes.map((route) => ({ value: readString(route, "id") ?? "", label: `${readString(route, "id") ?? "route"} · ${readString(route, "category") ?? "category"}` })).filter((option) => option.value.length > 0);
  const promptOptions = (props.promptProfiles ?? []).map((profile) => ({ value: readString(profile, "id") ?? "", label: `${readString(profile, "id") ?? "prompt"} · ${readString(profile, "status") ?? "draft"}` })).filter((option) => option.value.length > 0);
  const topicOptions = deriveTopicOptions(props.routes, props.outputs);
  const finalChannelOptions = Array.from(new Set(props.outputs.map((output) => readString(output, "finalChatId")).filter(Boolean) as string[])).map((value) => ({ value, label: value }));
  const routeExists = existingRouteIds.has(routeDraft.id);
  const outputExists = existingOutputIds.has(outputDraft.id);

  useEffect(() => {
    if (props.categoryScope && props.categoryScope !== "all" && routeDraft.category.length === 0) { const scope = props.categoryScope ?? ""; setRouteDraft((draft) => ({ ...draft, category: scope, id: draft.id || slug(scope) })); }
  }, [props.categoryScope]);

  function updateRouteCategory(category: string): void {
    setRouteDraft((draft) => ({ ...draft, category, id: draft.id.length > 0 ? draft.id : slug(category) }));
  }

  function updateOutputRoute(routeId: string): void {
    const route = props.routes.find((entry) => readString(entry, "id") === routeId);
    const category = readString(route, "category") ?? routeId;
    setOutputDraft((draft) => ({ ...draft, routeId, id: draft.id || `${slug(category)}_${draft.language || "fa"}` }));
  }

  function updateOutputLanguage(language: string): void {
    const route = props.routes.find((entry) => readString(entry, "id") === outputDraft.routeId);
    const category = readString(route, "category") ?? (outputDraft.routeId || "output");
    setOutputDraft((draft) => ({ ...draft, language, id: draft.id.length === 0 || draft.id.endsWith(`_${draft.language}`) ? `${slug(category)}_${language}` : draft.id }));
  }

  return <div className="page-grid">
    <Card className="hero-card"><CardHeader eyebrow="Routes & Outputs Builder" title="Category-first Telegram routing" description="Route = category/source topic. Output = language, review topic, final channel, publish policy, signature, and prompt binding." /><Alert title="Operator model" tone="info">Pick a category, then create its source route and language outputs. Numeric topic IDs are still stored, but labels and suggestions keep the topology visible.</Alert></Card>
    <Card><CardHeader title={routeExists ? `Editing route ${routeDraft.id}` : "Create route"} description="Source topic to category and fallback prompt." /><div className="grid two"><Input label="Route ID" value={routeDraft.id} onChange={(id) => setRouteDraft({ ...routeDraft, id })} placeholder="crypto" /><Select label="Category" value={routeDraft.category} onChange={updateRouteCategory} options={[...categories, routeDraft.category || "crypto"].filter(Boolean).filter(unique).map((value) => ({ value, label: value }))} /><Input label="Source chat ID" value={routeDraft.sourceChatId} onChange={(sourceChatId) => setRouteDraft({ ...routeDraft, sourceChatId })} placeholder="-100..." /><Select label="Known source topic" value={`${routeDraft.sourceChatId}:${routeDraft.sourceThreadId}`} onChange={(value) => { const [sourceChatId = "", sourceThreadId = ""] = value.split(":"); setRouteDraft({ ...routeDraft, sourceChatId, sourceThreadId }); }} options={[{ value: `${routeDraft.sourceChatId}:${routeDraft.sourceThreadId}`, label: routeDraft.sourceThreadId ? topicLabel("Current", routeDraft.sourceChatId, Number(routeDraft.sourceThreadId)) : "Choose known topic" }, ...topicOptions.filter((option) => option.role === "source").map((option) => ({ value: `${option.chatId}:${option.threadId}`, label: option.label }))]} /><Input label="Source topic/thread ID" type="number" value={routeDraft.sourceThreadId} onChange={(sourceThreadId) => setRouteDraft({ ...routeDraft, sourceThreadId })} /><Select label="Fallback prompt profile" value={routeDraft.promptProfile} onChange={(promptProfile) => setRouteDraft({ ...routeDraft, promptProfile })} options={promptOptions.length > 0 ? promptOptions : [{ value: routeDraft.promptProfile, label: routeDraft.promptProfile || "No prompts yet" }]} /><Switch label="Route enabled" checked={routeDraft.enabled} onChange={(enabled) => setRouteDraft({ ...routeDraft, enabled })} /></div><div className="button-row"><Button disabled={props.busy !== undefined || !routeDraft.id} onClick={() => void props.onSaveRoute(routePayload(routeDraft), routeExists)}>{routeExists ? "Update route" : "Create route"}</Button><Button variant="secondary" onClick={() => setRouteDraft(emptyRoute)}>Clear route form</Button></div></Card>
    <Card><CardHeader title="Existing routes" description="Edit loads the row into the form. Source topic is shown with a human label." /><DataTable rows={props.routes} columns={[{ key: "id", label: "Route" }, { key: "category", label: "Category" }, { key: "source", label: "Source topic", render: (row) => topicLabel("Source", readString(row, "sourceChatId"), readNumber(row, "sourceThreadId")) }, { key: "promptProfile", label: "Fallback prompt" }, { key: "enabled", label: "Status", render: (row) => <Badge tone={readBoolean(row, "enabled") === false ? "muted" : "success"}>{readBoolean(row, "enabled") === false ? "Disabled" : "Enabled"}</Badge> }, { key: "action", label: "Action", render: (row) => <div className="inline-actions"><Button size="sm" variant="secondary" onClick={() => setRouteDraft(routeDraftFromRow(row))}>Edit</Button><Button size="sm" variant="ghost" onClick={() => void props.onDisableRoute(readString(row, "id") ?? "")} disabled={!readString(row, "id")}>Disable</Button></div> }]} /></Card>
    <Card><CardHeader title={outputExists ? `Editing output ${outputDraft.id}` : "Create output"} description="Language, review topic, final channel, schedule, signature, and prompt binding." /><div className="grid two"><Input label="Output ID" value={outputDraft.id} onChange={(id) => setOutputDraft({ ...outputDraft, id })} placeholder="crypto_fa" /><Select label="Route" value={outputDraft.routeId} onChange={updateOutputRoute} options={routeOptions.length > 0 ? routeOptions : [{ value: outputDraft.routeId, label: outputDraft.routeId || "Create a route first" }]} /><Select label="Language" value={outputDraft.language} onChange={updateOutputLanguage} options={languages} /><Input label="Review chat ID" value={outputDraft.reviewChatId} onChange={(reviewChatId) => setOutputDraft({ ...outputDraft, reviewChatId })} /><Select label="Known review topic" value={`${outputDraft.reviewChatId}:${outputDraft.reviewThreadId}`} onChange={(value) => { const [reviewChatId = "", reviewThreadId = ""] = value.split(":"); setOutputDraft({ ...outputDraft, reviewChatId, reviewThreadId }); }} options={[{ value: `${outputDraft.reviewChatId}:${outputDraft.reviewThreadId}`, label: outputDraft.reviewThreadId ? topicLabel("Current", outputDraft.reviewChatId, Number(outputDraft.reviewThreadId)) : "Choose known topic" }, ...topicOptions.filter((option) => option.role === "review").map((option) => ({ value: `${option.chatId}:${option.threadId}`, label: option.label }))]} /><Input label="Review topic/thread ID" type="number" value={outputDraft.reviewThreadId} onChange={(reviewThreadId) => setOutputDraft({ ...outputDraft, reviewThreadId })} /><Select label="Final channel/chat ID" value={outputDraft.finalChatId} onChange={(finalChatId) => setOutputDraft({ ...outputDraft, finalChatId })} options={[{ value: outputDraft.finalChatId, label: outputDraft.finalChatId || "Enter final channel" }, ...finalChannelOptions]} /><Input label="Final thread ID" type="number" value={outputDraft.finalThreadId} onChange={(finalThreadId) => setOutputDraft({ ...outputDraft, finalThreadId })} /><Select label="Publish mode" value={outputDraft.publishMode} onChange={(publishMode) => setOutputDraft({ ...outputDraft, publishMode })} options={["queued", "scheduled", "immediate"].map((value) => ({ value, label: value }))} /><Select label="Timezone" value={outputDraft.timezone} onChange={(timezone) => setOutputDraft({ ...outputDraft, timezone })} options={timezones.map((value) => ({ value, label: value }))} /><Input label="Allowed windows" value={outputDraft.allowedPublishWindows} onChange={(allowedPublishWindows) => setOutputDraft({ ...outputDraft, allowedPublishWindows })} placeholder="09:00-23:00, 00:00-02:00" /><Select label="Minimum gap" value={outputDraft.minimumGapMinutes} onChange={(minimumGapMinutes) => setOutputDraft({ ...outputDraft, minimumGapMinutes })} options={gapPresets} /><Select label="Max posts/hour" value={outputDraft.maxPostsPerHour} onChange={(maxPostsPerHour) => setOutputDraft({ ...outputDraft, maxPostsPerHour })} options={hourlyPresets} /><Input label="Max posts/day" type="number" value={outputDraft.maxPostsPerDay} onChange={(maxPostsPerDay) => setOutputDraft({ ...outputDraft, maxPostsPerDay })} /><Input label="Queue priority" type="number" value={outputDraft.queuePriority} onChange={(queuePriority) => setOutputDraft({ ...outputDraft, queuePriority })} /><Switch label="Publish enabled" checked={outputDraft.publishEnabled} onChange={(publishEnabled) => setOutputDraft({ ...outputDraft, publishEnabled })} /><Switch label="Signature enabled" checked={outputDraft.signatureEnabled} onChange={(signatureEnabled) => setOutputDraft({ ...outputDraft, signatureEnabled })} /></div><Textarea label="Signature text" value={outputDraft.signatureText} onChange={(signatureText) => setOutputDraft({ ...outputDraft, signatureText })} rows={3} /><Input label="Signature @handle" value={outputDraft.signatureChannelHandle} onChange={(signatureChannelHandle) => setOutputDraft({ ...outputDraft, signatureChannelHandle })} placeholder="@channel" /><div className="button-row"><Button disabled={props.busy !== undefined || !outputDraft.id || !outputDraft.routeId} onClick={() => void props.onSaveOutput(outputDraft.routeId, outputPayload(outputDraft), outputExists)}>{outputExists ? "Update output" : "Create output"}</Button><Button variant="secondary" onClick={() => setOutputDraft(emptyOutput)}>Clear output form</Button></div></Card>
    <Card><CardHeader title="Output matrix" description="Use this table to confirm each language has review, final, prompt and publish policy context." /><OutputMatrix outputs={props.outputs} bindings={props.bindings ?? []} issues={props.issues ?? []} /></Card>
    <Card><CardHeader title="Existing outputs" description="Edit loads an output into the form." /><DataTable rows={props.outputs} columns={[{ key: "id", label: "Output" }, { key: "routeId", label: "Route" }, { key: "language", label: "Lang" }, { key: "review", label: "Review topic", render: (row) => topicLabel("Review", readString(row, "reviewChatId"), readNumber(row, "reviewThreadId")) }, { key: "finalChatId", label: "Final" }, { key: "publishMode", label: "Mode" }, { key: "timing", label: "Timing", render: (row) => `${readNumber(row, "minimumGapMinutes") ?? 0}m · ${readNumber(row, "maxPostsPerHour") ?? 0}/h` }, { key: "action", label: "Action", render: (row) => <div className="inline-actions"><Button size="sm" variant="secondary" onClick={() => setOutputDraft(outputDraftFromRow(row))}>Edit</Button><Button size="sm" variant="ghost" onClick={() => void props.onDisableOutput(readString(row, "id") ?? "")} disabled={!readString(row, "id")}>Disable</Button></div> }]} /></Card>
  </div>;
}

function routePayload(draft: RouteDraft): JsonObject { return { id: draft.id.trim(), category: draft.category.trim(), sourceChatId: draft.sourceChatId.trim(), sourceThreadId: toNumber(draft.sourceThreadId, 0), promptProfile: draft.promptProfile.trim(), enabled: draft.enabled }; }
function outputPayload(draft: OutputDraft): JsonObject { return { id: draft.id.trim(), language: draft.language, reviewChatId: draft.reviewChatId.trim(), reviewThreadId: toNumber(draft.reviewThreadId, 0), finalChatId: draft.finalChatId.trim(), ...(draft.finalThreadId.trim() ? { finalThreadId: toNumber(draft.finalThreadId, 0) } : {}), publishEnabled: draft.publishEnabled, publishMode: draft.publishMode, timezone: draft.timezone, allowedPublishWindows: draft.allowedPublishWindows.split(",").map((entry) => entry.trim()).filter(Boolean), minimumGapMinutes: toNumber(draft.minimumGapMinutes, 10), maxPostsPerHour: toNumber(draft.maxPostsPerHour, 4), maxPostsPerDay: toNumber(draft.maxPostsPerDay, 24), queuePriority: toNumber(draft.queuePriority, 0), signatureEnabled: draft.signatureEnabled, ...(draft.signatureText.trim() ? { signatureText: draft.signatureText.trim() } : {}), ...(draft.signatureChannelHandle.trim() ? { signatureChannelHandle: draft.signatureChannelHandle.trim() } : {}), signaturePosition: draft.signaturePosition }; }
function routeDraftFromRow(row: JsonObject): RouteDraft { return { id: readString(row, "id") ?? "", category: readString(row, "category") ?? "", sourceChatId: readString(row, "sourceChatId") ?? "", sourceThreadId: String(readNumber(row, "sourceThreadId") ?? ""), promptProfile: readString(row, "promptProfile") ?? "", enabled: readBoolean(row, "enabled") !== false }; }
function outputDraftFromRow(row: JsonObject): OutputDraft { return { id: readString(row, "id") ?? "", routeId: readString(row, "routeId") ?? "", language: readString(row, "language") ?? "fa", reviewChatId: readString(row, "reviewChatId") ?? "", reviewThreadId: String(readNumber(row, "reviewThreadId") ?? ""), finalChatId: readString(row, "finalChatId") ?? "", finalThreadId: String(readNumber(row, "finalThreadId") ?? ""), publishEnabled: readBoolean(row, "publishEnabled") !== false, publishMode: readString(row, "publishMode") ?? "queued", timezone: readString(row, "timezone") ?? "Asia/Tehran", allowedPublishWindows: Array.isArray(row.allowedPublishWindows) ? row.allowedPublishWindows.filter((entry): entry is string => typeof entry === "string").join(", ") : "", minimumGapMinutes: String(readNumber(row, "minimumGapMinutes") ?? 10), maxPostsPerHour: String(readNumber(row, "maxPostsPerHour") ?? 4), maxPostsPerDay: String(readNumber(row, "maxPostsPerDay") ?? 24), queuePriority: String(readNumber(row, "queuePriority") ?? 0), signatureEnabled: readBoolean(row, "signatureEnabled") === true, signatureText: readString(row, "signatureText") ?? "", signatureChannelHandle: readString(row, "signatureChannelHandle") ?? "", signaturePosition: readString(row, "signaturePosition") ?? "append" }; }

function deriveTopicOptions(routes: JsonObject[], outputs: JsonObject[]): Array<{ role: "source" | "review" | "final"; chatId: string; threadId: string; label: string }> {
  const topics: Array<{ role: "source" | "review" | "final"; chatId: string; threadId: string; label: string }> = [];
  for (const route of routes) {
    const chatId = readString(route, "sourceChatId");
    const threadId = readNumber(route, "sourceThreadId");
    if (chatId && threadId !== undefined) topics.push({ role: "source", chatId, threadId: String(threadId), label: `${readString(route, "category") ?? "Category"} Source #${threadId}` });
  }
  for (const output of outputs) {
    const reviewChatId = readString(output, "reviewChatId");
    const reviewThreadId = readNumber(output, "reviewThreadId");
    if (reviewChatId && reviewThreadId !== undefined) topics.push({ role: "review", chatId: reviewChatId, threadId: String(reviewThreadId), label: `${readString(output, "id") ?? "Output"} Review #${reviewThreadId}` });
    const finalChatId = readString(output, "finalChatId");
    const finalThreadId = readNumber(output, "finalThreadId") ?? 0;
    if (finalChatId) topics.push({ role: "final", chatId: finalChatId, threadId: String(finalThreadId), label: `${readString(output, "id") ?? "Output"} Final ${finalChatId}` });
  }
  return topics.filter((topic, index, all) => all.findIndex((entry) => entry.role === topic.role && entry.chatId === topic.chatId && entry.threadId === topic.threadId) === index);
}

function toNumber(value: string, fallback: number): number { if (value.trim() === "") return fallback; const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; }
function slug(value: string): string { return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "route"; }
function unique(value: string, index: number, values: string[]): boolean { return values.indexOf(value) === index; }
