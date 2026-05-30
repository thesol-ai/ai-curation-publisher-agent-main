import { Alert, Badge, Button, Card, CardHeader, DataTable, Select, StatCard } from "../../shared/ui";
import type { JsonObject } from "../../types";
import { readBoolean, readNumber, readObject, readString, statusTone } from "./dashboard-utils";

export type CategoryScope = "all" | string;

type CategorySummary = {
  category: string;
  routeIds: string[];
  sourceTopics: string[];
  outputs: JsonObject[];
  languages: string[];
  promptBound: number;
  issues: JsonObject[];
};

export function categoryOptions(routes: JsonObject[]): Array<{ value: string; label: string }> {
  const categories = Array.from(new Set(routes.map((route) => readString(route, "category") ?? "uncategorized"))).sort();
  return [{ value: "all", label: "All categories" }, ...categories.map((category) => ({ value: category, label: category }))];
}

export function filterRoutesByScope(routes: JsonObject[], scope: CategoryScope): JsonObject[] {
  if (scope === "all") return routes;
  return routes.filter((route) => (readString(route, "category") ?? "uncategorized") === scope);
}

export function filterOutputsByScope(outputs: JsonObject[], scope: CategoryScope): JsonObject[] {
  if (scope === "all") return outputs;
  return outputs.filter((output) => (readString(output, "category") ?? "uncategorized") === scope);
}

export function filterIssuesByScope(issues: JsonObject[], routes: JsonObject[], scope: CategoryScope): JsonObject[] {
  if (scope === "all") return issues;
  const routeIds = new Set(filterRoutesByScope(routes, scope).map((route) => readString(route, "id")).filter(Boolean) as string[]);
  return issues.filter((issue) => {
    const routeId = readString(issue, "routeId");
    if (routeId === undefined) return true;
    return routeIds.has(routeId);
  });
}

export function filterQueueByScope(queue: JsonObject[], scope: CategoryScope): JsonObject[] {
  if (scope === "all") return queue;
  return queue.filter((row) => (readString(row, "category") ?? "") === scope || (readString(row, "routeId") ?? "").startsWith(scope));
}

export function CategoryScopeSelector({ routes, scope, onChange }: { routes: JsonObject[]; scope: CategoryScope; onChange: (scope: CategoryScope) => void }): JSX.Element {
  return <Card className="category-scope-card"><CardHeader eyebrow="Operator scope" title="Category workspace" description="Scope the dashboard to one category so routes, outputs, prompts, publishing and diagnostics stay connected." /><Select label="Scope" value={scope} onChange={onChange} options={categoryOptions(routes)} /></Card>;
}

export function EnvironmentBanner({ summary, apiBaseUrl }: { summary: JsonObject | undefined; apiBaseUrl: string }): JSX.Element {
  const details = readObject(summary, "environmentDetails");
  const d1 = readObject(details, "d1");
  const safety = readObject(details, "safety");
  const environment = readString(details, "environment") ?? readString(summary, "environment") ?? "unknown";
  const tone = environment === "production" ? "danger" : environment === "staging" ? "warning" : "info";
  return <div className="environment-banner"><Badge tone={tone}>{environment.toUpperCase()}</Badge><span>Worker: <strong>{readString(details, "workerName") ?? readString(summary, "service") ?? "unknown"}</strong></span><span>DB: <strong>{readString(d1, "databaseName") ?? "unknown"}</strong></span><span>Binding: <strong>{readString(d1, "binding") ?? "DB"}</strong></span><span>URL: <strong>{apiBaseUrl || readString(details, "publicBaseUrl") || "not saved"}</strong></span>{readBoolean(safety, "production") === true && <Badge tone="danger">production guarded</Badge>}</div>;
}

export function CategoryHealthTable({ routes, outputs, bindings, issues }: { routes: JsonObject[]; outputs: JsonObject[]; bindings: JsonObject[]; issues: JsonObject[] }): JSX.Element {
  const rows = buildCategorySummaries(routes, outputs, bindings, issues).map((summary) => ({
    category: summary.category,
    sourceTopics: summary.sourceTopics.join(", ") || "-",
    routes: summary.routeIds.join(", ") || "-",
    outputs: summary.outputs.length,
    languages: summary.languages.join(", ") || "-",
    promptStatus: `${summary.promptBound}/${summary.outputs.length} bound`,
    issues: summary.issues.length,
    status: summary.issues.some((issue) => readString(issue, "severity") === "error") ? "blocked" : summary.issues.length > 0 ? "needs_setup" : "ready"
  }));
  return <Card><CardHeader title="Category health" description="One row per category. This is the source-of-truth map for source topics, outputs, prompts and publishing readiness." /><DataTable rows={rows} columns={[{ key: "category", label: "Category" }, { key: "sourceTopics", label: "Source topic" }, { key: "routes", label: "Route" }, { key: "outputs", label: "Outputs" }, { key: "languages", label: "Languages" }, { key: "promptStatus", label: "Prompt bindings" }, { key: "issues", label: "Issues" }, { key: "status", label: "Topology", render: (row) => <Badge tone={readString(row, "status") === "ready" ? "success" : readString(row, "status") === "blocked" ? "danger" : "warning"}>{readString(row, "status")}</Badge> }]} /></Card>;
}

export function CategoryWorkspace({ routes, outputs, bindings, issues, scope }: { routes: JsonObject[]; outputs: JsonObject[]; bindings: JsonObject[]; issues: JsonObject[]; scope: CategoryScope }): JSX.Element {
  const summaries = buildCategorySummaries(routes, outputs, bindings, issues).filter((summary) => scope === "all" || summary.category === scope);
  if (summaries.length === 0) return <Card><CardHeader title="Category workspace" description="No category is available for the current scope." /></Card>;
  return <div className="category-workspace-grid">{summaries.map((summary) => <Card key={summary.category}><CardHeader eyebrow="Category workspace" title={summary.category} description={`Routes: ${summary.routeIds.join(", ") || "none"}`} /><div className="stats-grid compact"><StatCard label="Outputs" value={summary.outputs.length} /><StatCard label="Languages" value={summary.languages.join(", ") || "-"} /><StatCard label="Issues" value={summary.issues.length} tone={summary.issues.length > 0 ? "warning" : "success"} /></div><OutputMatrix outputs={summary.outputs} bindings={bindings} issues={summary.issues} /><TopologySketch routes={routes.filter((route) => (readString(route, "category") ?? "uncategorized") === summary.category)} outputs={summary.outputs} bindings={bindings} /></Card>)}</div>;
}

export function OutputMatrix({ outputs, bindings, issues }: { outputs: JsonObject[]; bindings: JsonObject[]; issues: JsonObject[] }): JSX.Element {
  const rows = outputs.map((output) => {
    const id = readString(output, "id") ?? "unknown";
    const binding = bindings.find((entry) => readString(entry, "routeOutputId") === id || (readString(entry, "routeId") === readString(output, "routeId") && readString(entry, "language") === readString(output, "language")));
    const outputIssues = issues.filter((issue) => readString(issue, "outputId") === id || readString(issue, "routeId") === readString(output, "routeId"));
    return {
      id,
      language: readString(output, "language") ?? "-",
      review: topicLabel("Review", readString(output, "reviewChatId"), readNumber(output, "reviewThreadId")),
      prompt: readString(binding, "promptProfileId") ?? readString(output, "promptProfile") ?? "missing",
      final: topicLabel("Final", readString(output, "finalChatId"), readNumber(output, "finalThreadId")),
      publish: `${readString(output, "publishMode") ?? "queued"}, gap ${readNumber(output, "minimumGapMinutes") ?? 0}m`,
      max: `${readNumber(output, "maxPostsPerHour") ?? 0}/h · ${readNumber(output, "maxPostsPerDay") ?? 0}/d`,
      status: readBoolean(output, "enabled") === false ? "disabled" : outputIssues.length > 0 ? "issue" : "ready"
    };
  });
  return <DataTable rows={rows} emptyText="No outputs for this category yet." columns={[{ key: "id", label: "Output" }, { key: "language", label: "Lang" }, { key: "review", label: "Review topic" }, { key: "prompt", label: "Prompt" }, { key: "final", label: "Final" }, { key: "publish", label: "Publish" }, { key: "max", label: "Limits" }, { key: "status", label: "Status", render: (row) => <Badge tone={statusTone(readString(row, "status"))}>{readString(row, "status")}</Badge> }]} />;
}

export function RouteTimingSummary({ outputs, onEditRoutes }: { outputs: JsonObject[]; onEditRoutes?: () => void }): JSX.Element {
  const rows = outputs.map((output) => ({
    id: readString(output, "id") ?? "unknown",
    category: readString(output, "category") ?? "-",
    language: readString(output, "language") ?? "-",
    timezone: readString(output, "timezone") ?? "UTC",
    gap: `${readNumber(output, "minimumGapMinutes") ?? 0}m`,
    hourly: readNumber(output, "maxPostsPerHour") ?? 0,
    daily: readNumber(output, "maxPostsPerDay") ?? 0,
    windows: Array.isArray(output.allowedPublishWindows) && output.allowedPublishWindows.length > 0 ? output.allowedPublishWindows.join(", ") : "all day"
  }));
  return <Card><CardHeader title="Route output timing" description="Timing is configured per output, not globally. Use this as the publishing source of truth." action={onEditRoutes ? <Button size="sm" variant="secondary" onClick={onEditRoutes}>Edit in Routes</Button> : undefined} /><DataTable rows={rows} emptyText="No route outputs configured." columns={[{ key: "id", label: "Output" }, { key: "category", label: "Category" }, { key: "language", label: "Lang" }, { key: "timezone", label: "Timezone" }, { key: "gap", label: "Gap" }, { key: "hourly", label: "Max/hour" }, { key: "daily", label: "Max/day" }, { key: "windows", label: "Windows" }]} /></Card>;
}

export function SecretOverview({ summary }: { summary: JsonObject | undefined }): JSX.Element {
  const secrets = readObject(summary, "secrets") ?? {};
  const sources = readObject(summary, "secretSources") ?? {};
  const rows = Object.keys(secrets).sort().map((key) => ({ key, configured: Boolean(secrets[key]), source: readString(sources, key) ?? (secrets[key] === true ? "configured" : "missing") }));
  return <Card><CardHeader title="Secret overview" description="Values are never displayed. Source explains whether the effective secret comes from env/Worker Secret, encrypted D1, or is missing." /><DataTable rows={rows} columns={[{ key: "key", label: "Secret" }, { key: "configured", label: "Status", render: (row) => <Badge tone={readBoolean(row, "configured") ? "success" : "warning"}>{readBoolean(row, "configured") ? "configured" : "missing"}</Badge> }, { key: "source", label: "Source", render: (row) => <Badge tone={readString(row, "source") === "missing" ? "danger" : "info"}>{readString(row, "source")}</Badge> }]} /></Card>;
}

export function MediaPipelineDiagram(): JSX.Element {
  return <Card><CardHeader title="Media pipeline" description="Media Cache is internal infrastructure. It should not be used as a source or review topic." /><div className="pipeline-flow"><span>Source link</span><b>→</b><span>GitHub workflow</span><b>→</b><span>Media Cache topic</span><b>→</b><span>Telegram file_id</span><b>→</b><span>Review/final reuse</span></div><Alert title="Review rule" tone="info">When media is pending, avoid duplicate text-only review. Send media-ready review after file IDs are available; use text fallback only when media processing fails.</Alert></Card>;
}

export function topicLabel(prefix: string, chatId: string | undefined, threadId?: number): string {
  if (!chatId && threadId === undefined) return "missing";
  const thread = threadId === undefined ? "" : ` #${threadId}`;
  return `${prefix}: ${chatId ?? "chat?"}${thread}`;
}

function buildCategorySummaries(routes: JsonObject[], outputs: JsonObject[], bindings: JsonObject[], issues: JsonObject[]): CategorySummary[] {
  const categories = Array.from(new Set(routes.map((route) => readString(route, "category") ?? "uncategorized"))).sort();
  return categories.map((category) => {
    const categoryRoutes = routes.filter((route) => (readString(route, "category") ?? "uncategorized") === category);
    const routeIds = categoryRoutes.map((route) => readString(route, "id")).filter(Boolean) as string[];
    const categoryOutputs = outputs.filter((output) => (readString(output, "category") ?? "uncategorized") === category || routeIds.includes(readString(output, "routeId") ?? ""));
    const languages = Array.from(new Set(categoryOutputs.map((output) => readString(output, "language") ?? "unknown"))).sort();
    const categoryIssues = issues.filter((issue) => routeIds.includes(readString(issue, "routeId") ?? "") || categoryOutputs.some((output) => readString(output, "id") === readString(issue, "outputId")));
    const promptBound = categoryOutputs.filter((output) => bindings.some((binding) => readString(binding, "routeOutputId") === readString(output, "id") || (readString(binding, "routeId") === readString(output, "routeId") && readString(binding, "language") === readString(output, "language")))).length;
    return { category, routeIds, sourceTopics: categoryRoutes.map((route) => topicLabel("Source", readString(route, "sourceChatId"), readNumber(route, "sourceThreadId"))), outputs: categoryOutputs, languages, promptBound, issues: categoryIssues };
  });
}

function TopologySketch({ routes, outputs, bindings }: { routes: JsonObject[]; outputs: JsonObject[]; bindings: JsonObject[] }): JSX.Element {
  return <div className="topology-sketch">{routes.map((route) => <div key={readString(route, "id") ?? "route"} className="topology-route"><strong>{topicLabel("Source", readString(route, "sourceChatId"), readNumber(route, "sourceThreadId"))}</strong><span>Route: {readString(route, "id")}</span><div className="topology-output-grid">{outputs.filter((output) => readString(output, "routeId") === readString(route, "id")).map((output) => { const binding = bindings.find((entry) => readString(entry, "routeOutputId") === readString(output, "id")); return <div key={readString(output, "id") ?? "output"} className="topology-output"><Badge tone="info">{readString(output, "language") ?? "?"}</Badge><strong>{readString(output, "id")}</strong><small>{topicLabel("Review", readString(output, "reviewChatId"), readNumber(output, "reviewThreadId"))}</small><small>Prompt: {readString(binding, "promptProfileId") ?? "missing"}</small><small>Final: {readString(output, "finalChatId") ?? "missing"}</small></div>; })}</div></div>)}</div>;
}
