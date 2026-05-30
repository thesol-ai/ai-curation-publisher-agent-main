import { Alert, Badge, Button, Card, CardHeader, DataTable, Progress } from "../../shared/ui";
import type { AdminConfigResponse, JsonObject } from "../../types";
import { readBoolean, readNumber, readObject, readString, statusTone } from "./dashboard-utils";

type Props = {
  summary: JsonObject | undefined;
  validation: JsonObject | undefined;
  adminConfig: AdminConfigResponse | undefined;
  routes: JsonObject[];
  outputs: JsonObject[];
  onOpenTab: (tab: string) => void;
  onTest: (input: JsonObject) => Promise<void>;
  testResult: JsonObject | undefined;
  busy: string | undefined;
};

export function SetupWizardPanel({ summary, validation, adminConfig, routes, outputs, onOpenTab, onTest, testResult, busy }: Props): JSX.Element {
  const secrets = readObject(summary, "secrets");
  const media = readObject(summary, "media");
  const readiness = readObject(summary, "readiness") ?? readObject(validation, "readiness");
  const steps: Array<{ name: string; complete: boolean; tab: string; detail: string; test?: JsonObject }> = [
    { name: "Connect Worker", complete: Boolean(summary), tab: "overview", detail: "Worker URL saved and API reachable." },
    { name: "Admin Access", complete: readBooleanValue(secrets?.internalApiSecret), tab: "diagnostics", detail: "INTERNAL_API_SECRET is required for admin operations." },
    { name: "Telegram Bot", complete: readBooleanValue(secrets?.telegramBotToken), tab: "telegram", test: { kind: "bot" }, detail: "Bot token must be configured before real review/publish." },
    { name: "Internal Media Registry", complete: Boolean(readString(media, "cacheChatId") && readString(media, "cacheThreadId")), tab: "media", detail: "Media cache chat/topic stores reusable Telegram file IDs." },
    { name: "Routes", complete: routes.length > 0, tab: "routes", detail: "At least one source route should be enabled." },
    { name: "Outputs", complete: outputs.length > 0, tab: "routes", detail: "Each route needs review/final language outputs." },
    { name: "AI", complete: findSetting(adminConfig, "AI_PROVIDER")?.configured === true, tab: "ai", test: { provider: findSetting(adminConfig, "AI_PROVIDER")?.value ?? "mock", model: findSetting(adminConfig, "AI_MODEL")?.value ?? "mock" }, detail: "Choose mock/OpenAI/Gemini/custom and configure credentials." },
    { name: "Publishing", complete: readNumber(readiness, "errors") === 0, tab: "publishing", detail: "Resolve launch blockers and choose manual or scheduled publishing." }
  ];
  const reviewRows = outputs.map((output) => ({ kind: "review", routeOutputId: readString(output, "id"), chatId: readString(output, "reviewChatId"), threadId: readNumber(output, "reviewThreadId"), status: readString(output, "reviewChatId") ? "ready_to_test" : "missing" }));
  const finalRows = outputs.map((output) => ({ kind: "final", routeOutputId: readString(output, "id"), chatId: readString(output, "finalChatId"), threadId: readNumber(output, "finalThreadId"), status: readString(output, "finalChatId") ? "ready_to_test" : "missing" }));
  return <div className="page-grid">
    <Card className="hero-card"><CardHeader eyebrow="Setup Wizard 2.0" title="Guided launch path" description="A practical setup cockpit. Open the matching tab to save settings, then run targeted tests from here." /><Progress value={Math.round((steps.filter((step) => step.complete).length / steps.length) * 100)} label="Setup progress" /></Card>
    <Card><CardHeader title="Transactional setup steps" description="Each step shows status, direct navigation, and safe tests when available." /><div className="wizard-grid">{steps.map((step) => <div key={step.name} className="wizard-step"><Badge tone={step.complete ? "success" : "warning"}>{step.complete ? "complete" : "needs setup"}</Badge><strong>{step.name}</strong><p>{step.detail}</p><div className="inline-actions"><Button size="sm" variant="secondary" onClick={() => onOpenTab(step.tab)}>Open {step.tab}</Button>{renderStepTestButton(step.test, onTest, busy)}</div></div>)}</div></Card>
    <Card><CardHeader title="Telegram permission matrix" description="Check every review and final target configured for route outputs." /><DataTable rows={[...reviewRows, ...finalRows]} columns={[{ key: "kind", label: "Target" }, { key: "routeOutputId", label: "Output" }, { key: "chatId", label: "Chat" }, { key: "threadId", label: "Thread" }, { key: "status", label: "Status", render: (row) => <Badge tone={statusTone(readString(row, "status"))}>{readString(row, "status") ?? "unknown"}</Badge> }, { key: "action", label: "Action", render: (row) => { const chatId = readString(row, "chatId"); if (!chatId) return <span className="muted-text">-</span>; return <Button size="sm" variant="secondary" disabled={busy !== undefined} onClick={() => void onTest(telegramTestPayload(chatId, readNumber(row, "threadId")))}>Test reachability</Button>; } }]} /></Card>
    {testResult && <Card><CardHeader title="Latest setup test result" description="Redacted backend response." /><pre>{JSON.stringify(testResult, null, 2)}</pre></Card>}
  </div>;
}

function renderStepTestButton(test: JsonObject | undefined, onTest: (input: JsonObject) => Promise<void>, busy: string | undefined): JSX.Element | null {
  if (test === undefined) return null;
  return <Button size="sm" disabled={busy !== undefined} onClick={() => void onTest(test)}>Run test</Button>;
}

function findSetting(adminConfig: AdminConfigResponse | undefined, key: string) {
  return adminConfig?.items.find((item) => item.key === key);
}

function readBooleanValue(value: unknown): boolean {
  return value === true || value === "true";
}

function telegramTestPayload(chatId: string, threadId?: number): JsonObject {
  const payload: JsonObject = { kind: "chat_action", chatId };
  if (threadId !== undefined) payload.threadId = threadId;
  return payload;
}
