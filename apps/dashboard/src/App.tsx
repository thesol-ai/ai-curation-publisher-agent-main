import { useCallback, useEffect, useMemo, useState } from "react";
import { describeConnectionBundle, validateWorkerBaseUrl, WorkerApiClient } from "./api";
import { buildWizardSteps, DASHBOARD_TABS, deriveOverviewCards, nextRecommendedAction, SAFE_TESTS, type DashboardTab, type WizardStepId } from "./dashboard-ux";
import { buildTelegramRouteManagerSummary, summarizeRecentTelegramOutputs, summarizeTelegramPublishQueue, telegramBotMissingText, telegramRouteManagerCopy, telegramRoutesEmptyStateText, telegramRoutesEmptyStateTitle, TELEGRAM_OUTPUT_FORM_FIELDS, TELEGRAM_ROUTE_FORM_FIELDS, type TelegramRouteManagerSummary } from "./telegram-route-manager";
import { redactSensitiveJson } from "./setup";
import { countErrors, countWarnings } from "./status";
import { clearOperationHistory, clearSettings, getInternalCredential, loadOperationHistory, loadSettings, saveApiBaseUrl, saveInternalCredential, saveOperationRecord } from "./storage";
import type { AdminAuditEntry, AdminConfigResponse, ApiResult, ConnectionFeedback, DashboardSettings, JsonObject, JsonValue, OperationName, OperationRecord, StatusBundle } from "./types";
import { buildWizardGuidance } from "./wizard-content";

const operationLabels: Record<OperationName, string> = {
  refresh_status: "Refresh status",
  internal_auth_probe: "Check admin access",
  telegram_review_dry_run: "Telegram review dry-run",
  wordpress_draft_dry_run: "WordPress draft dry-run",
  firecrawl_sandbox_fetch: "Firecrawl sandbox fetch",
  mock_e2e_smoke: "Mock E2E pipeline",
  scheduler_dry_run: "Scheduler dry-run",
  pilot_readiness: "Readiness check",
  pilot_firecrawl: "Firecrawl pilot",
  pilot_telegram_review: "Telegram pilot",
  pilot_wordpress_draft: "WordPress pilot",
  pilot_combined: "Combined pilot",
  admin_config_load: "Load settings",
  admin_config_save: "Save setting",
  admin_config_reset: "Reset setting",
  admin_config_audit: "Load activity"
};

const idleConnectionFeedback: ConnectionFeedback = {
  state: "idle",
  title: "Connection not checked",
  detail: "Enter the Worker URL, then save and check the connection.",
  guidance: ["Use the deployed workers.dev URL.", "The Worker URL is stored locally and is not sensitive."]
};

type SettingsSection = "general" | "telegram" | "activity" | "technical";
type RecentTelegramOutput = ReturnType<typeof summarizeRecentTelegramOutputs>[number];
type TelegramQueueItem = ReturnType<typeof summarizeTelegramPublishQueue>[number];

function App(): JSX.Element {
  const [settings, setSettings] = useState<DashboardSettings>(() => loadSettings());
  const [apiBaseUrlInput, setApiBaseUrlInput] = useState(settings.apiBaseUrl);
  const [credentialInput, setCredentialInput] = useState("");
  const [bundle, setBundle] = useState<StatusBundle>({});
  const [adminConfig, setAdminConfig] = useState<AdminConfigResponse | undefined>();
  const [audit, setAudit] = useState<AdminAuditEntry[]>([]);
  const [history, setHistory] = useState<OperationRecord[]>(() => loadOperationHistory());
  const [busy, setBusy] = useState<string | undefined>();
  const [notice, setNotice] = useState<string | undefined>();
  const [connectionFeedback, setConnectionFeedback] = useState<ConnectionFeedback>(idleConnectionFeedback);
  const [activeTab, setActiveTab] = useState<DashboardTab>("overview");
  const [activeStep, setActiveStep] = useState<WizardStepId>("connect");
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("telegram");
  const [telegramText, setTelegramText] = useState("Review dry-run from dashboard.");
  const [wordpressTitle, setWordpressTitle] = useState("Dashboard draft dry-run");
  const [wordpressContent, setWordpressContent] = useState("This is a draft-only setup check.");
  const [confirmTelegram, setConfirmTelegram] = useState(false);
  const [confirmWordPress, setConfirmWordPress] = useState(false);
  const [routeManagerData, setRouteManagerData] = useState<JsonObject | undefined>();
  const [recentTelegramOutputs, setRecentTelegramOutputs] = useState<RecentTelegramOutput[]>([]);
  const [telegramQueueItems, setTelegramQueueItems] = useState<TelegramQueueItem[]>([]);
  const [routeSeedJson, setRouteSeedJson] = useState(defaultRouteSeedJson);

  const client = useMemo(() => new WorkerApiClient(settings.apiBaseUrl, getInternalCredential()), [settings]);
  const workerReachable = bundle.health?.ok === true && bundle.status?.ok === true;
  const internalReady = settings.hasInternalCredential;
  const topicWorkflow = readObject(readObject(bundle.status?.ok === true ? bundle.status.data : undefined, "telegram"), "topicWorkflow") ?? readObject(readObject(bundle.ready?.ok === true ? bundle.ready.data : undefined, "summary"), "telegramTopicWorkflow");
  const routeManagerSummary = buildTelegramRouteManagerSummary(routeManagerData ?? topicWorkflow);
  const operatingMode = readString(bundle.status?.ok === true ? bundle.status.data : undefined, "operatingMode") ?? "manual_only";
  const aiProvider = readString(readObject(bundle.status?.ok === true ? bundle.status.data : undefined, "ai"), "provider") ?? "mock";
  const telegramReady = routeManagerSummary.routeCount > 0 || readBoolean(readObject(bundle.ready?.ok === true ? bundle.ready.data : undefined, "summary"), "hasTelegramConfig") === true;
  const wordpressReady = readBoolean(readObject(bundle.ready?.ok === true ? bundle.ready.data : undefined, "summary"), "hasWordPressConfig") === true;
  const providersOptional = operatingMode === "manual_only" || operatingMode === "mock_demo";
  const schedulerSafe = readBoolean(readObject(bundle.ready?.ok === true ? bundle.ready.data : undefined, "summary"), "setupSafe") !== false;
  const publishingSafe = routeManagerSummary.finalPublishing === "Disabled";
  const overviewCards = deriveOverviewCards({ workerReachable, hasAdminAccess: internalReady, operatingMode, aiProvider, telegramReady, wordpressReady, providersOptional, schedulerSafe, publishingSafe });
  const wizardSteps = buildWizardSteps({ workerReachable, hasAdminAccess: internalReady, operatingMode, aiReady: aiProvider !== "mock", telegramReady, wordpressReady, providersReady: providersOptional, routeCount: routeManagerSummary.routeCount, outputCount: routeManagerSummary.enabledOutputCount, finalPublishingEnabled: routeManagerSummary.finalPublishing === "Enabled" });
  const activeWizardStep = wizardSteps.find((step) => step.id === activeStep) ?? wizardSteps[0]!;

  const recordOperation = useCallback((name: OperationName, ok: boolean, result: JsonValue): void => {
    const safeResult = redactSensitiveJson(result);
    const record: OperationRecord = {
      id: `${Date.now()}-${name}`,
      name,
      label: operationLabels[name],
      timestamp: new Date().toISOString(),
      ok,
      warningsCount: countWarnings(safeResult),
      errorsCount: countErrors(safeResult),
      result: safeResult
    };
    setHistory(saveOperationRecord(record));
  }, []);

  const refreshStatus = useCallback(async (): Promise<void> => {
    setBusy("refresh_status");
    const next = await client.getStatusBundle();
    setBundle(next);
    const feedback = feedbackFromBundle(next);
    setConnectionFeedback(feedback);
    recordOperation("refresh_status", next.health?.ok === true && next.status?.ok === true, { health: resultToJson(next.health), status: resultToJson(next.status), ready: resultToJson(next.ready) });
    setNotice(feedback.title);
    setBusy(undefined);
  }, [client, recordOperation]);

  useEffect(() => {
    if (settings.apiBaseUrl.length > 0) void refreshStatus();
  }, [refreshStatus, settings.apiBaseUrl]);

  useEffect(() => {
    if (internalReady) {
      void loadRouteManager();
      void loadRecentTelegramOutputs();
      void loadTelegramQueue();
    }
  }, [internalReady, settings.apiBaseUrl]);

  async function saveAndCheckConnection(): Promise<void> {
    const valid = validateWorkerBaseUrl(apiBaseUrlInput);
    if (!valid.ok) {
      setConnectionFeedback({ state: "invalid_url", title: "Invalid Worker URL", detail: valid.message, guidance: connectionGuidance() });
      setNotice("Invalid Worker URL");
      return;
    }
    saveApiBaseUrl(valid.value);
    if (credentialInput.trim().length > 0) saveInternalCredential(credentialInput, false);
    setCredentialInput("");
    setSettings(loadSettings());
    await refreshStatus();
  }

  async function loadRouteManager(): Promise<void> {
    if (!internalReady) return;
    setBusy("telegram_route_config");
    const response = await client.getTelegramTopicRoutes();
    recordOperation("refresh_status", response.ok, resultToJson(response));
    if (response.ok) {
      setRouteManagerData(response.data);
      setNotice("Telegram routes loaded.");
    } else {
      setNotice(response.message);
    }
    setBusy(undefined);
  }

  async function validateRoutes(): Promise<void> {
    if (!internalReady) return;
    setBusy("telegram_route_config");
    const response = await client.validateTelegramTopicRoutes();
    recordOperation("refresh_status", response.ok, resultToJson(response));
    setNotice(response.ok ? "Telegram route validation completed." : response.message);
    await loadRouteManager();
    setBusy(undefined);
  }

  async function loadRecentTelegramOutputs(): Promise<void> {
    if (!internalReady) return;
    setBusy("telegram_outputs_recent");
    const response = await client.getRecentTelegramOutputs(20);
    if (response.ok) {
      setRecentTelegramOutputs(summarizeRecentTelegramOutputs(response.data.outputs));
      setNotice("Recent Telegram outputs loaded.");
    } else {
      setNotice(response.message);
    }
    setBusy(undefined);
  }

  async function loadTelegramQueue(): Promise<void> {
    if (!internalReady) return;
    setBusy("telegram_publish_queue");
    const response = await client.getTelegramPublishQueue(25);
    if (response.ok) {
      setTelegramQueueItems(summarizeTelegramPublishQueue(response.data.queue));
      setNotice("Telegram publish queue loaded.");
    } else {
      setNotice(response.message);
    }
    setBusy(undefined);
  }

  async function saveRouteSeedFromDashboard(): Promise<void> {
    if (!internalReady) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(routeSeedJson) as unknown;
    } catch {
      setNotice("Route JSON is invalid.");
      return;
    }
    const routes = Array.isArray(parsed) ? parsed : typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as JsonObject).routes : undefined;
    if (!Array.isArray(routes)) {
      setNotice("Route JSON must be an array or an object with a routes array.");
      return;
    }
    setBusy("telegram_route_save");
    const response = await client.seedTelegramTopicRoutes(routes as JsonValue);
    recordOperation("refresh_status", response.ok, resultToJson(response));
    setNotice(response.ok ? "Telegram routes saved." : response.message);
    await loadRouteManager();
    setBusy(undefined);
  }

  async function loadActivity(): Promise<void> {
    if (!internalReady) {
      setNotice("Admin access is needed first.");
      return;
    }
    setBusy("admin_config_audit");
    const response = await client.getAdminConfigAudit();
    if (response.ok) {
      setAudit(response.data.entries);
      setNotice("Activity loaded.");
    } else {
      setNotice(response.message);
    }
    setBusy(undefined);
  }

  async function runOperation(name: OperationName, runner: () => Promise<ApiResult>, confirmText?: string): Promise<void> {
    if (confirmText !== undefined && !window.confirm(confirmText)) return;
    setBusy(name);
    const result = await runner();
    recordOperation(name, result.ok, resultToJson(result));
    setNotice(result.ok ? `${operationLabels[name]} completed.` : `${operationLabels[name]} returned an error.`);
    setBusy(undefined);
  }

  function clearLocalSettings(): void {
    clearSettings();
    setApiBaseUrlInput("");
    setCredentialInput("");
    setSettings(loadSettings());
    setConnectionFeedback(idleConnectionFeedback);
    setNotice("Local dashboard settings cleared.");
  }

  return (
    <main className="shell">
      <header className="hero"><div><p className="eyebrow">Operator Dashboard</p><h1>Launch and manage safely.</h1><p>A guided admin console for setup, Telegram routing, safe tests, and activity review.</p></div><div className="heroPanel"><span>Scheduler safe by default</span><span>Public publishing disabled</span><span>Final Telegram publishing disabled by default</span></div></header>
      {notice && <div className="notice">{notice}</div>}
      <nav className="topTabs" aria-label="Dashboard sections">{DASHBOARD_TABS.map((tab) => <button type="button" key={tab.id} className={activeTab === tab.id ? "active" : "secondary"} onClick={() => setActiveTab(tab.id)}>{tab.label}</button>)}</nav>
      {activeTab === "overview" && <OverviewPage cards={overviewCards} onRefresh={() => void refreshStatus()} busy={busy !== undefined} />}
      {activeTab === "setup" && <SetupPage steps={wizardSteps} activeStep={activeWizardStep} setActiveStep={setActiveStep} body={<WizardBody id={activeWizardStep.id} connectionFeedback={connectionFeedback} apiBaseUrlInput={apiBaseUrlInput} setApiBaseUrlInput={setApiBaseUrlInput} credentialInput={credentialInput} setCredentialInput={setCredentialInput} saveAndCheckConnection={saveAndCheckConnection} clearLocalSettings={clearLocalSettings} routeManagerSummary={routeManagerSummary} workerReachable={workerReachable} internalReady={internalReady} operatingMode={operatingMode} aiProvider={aiProvider} wordpressReady={wordpressReady} />} />}
      {activeTab === "settings" && <SettingsPage internalReady={internalReady} section={settingsSection} setSection={setSettingsSection} routeManagerSummary={routeManagerSummary} onLoadRoutes={() => void loadRouteManager()} onValidateRoutes={() => void validateRoutes()} routeSeedJson={routeSeedJson} setRouteSeedJson={setRouteSeedJson} onSaveRouteSeed={() => void saveRouteSeedFromDashboard()} busy={busy !== undefined} />}
      {activeTab === "tests" && <TestsPage internalReady={internalReady} busy={busy} latest={history} telegramText={telegramText} setTelegramText={setTelegramText} wordpressTitle={wordpressTitle} setWordpressTitle={setWordpressTitle} wordpressContent={wordpressContent} setWordpressContent={setWordpressContent} confirmTelegram={confirmTelegram} setConfirmTelegram={setConfirmTelegram} confirmWordPress={confirmWordPress} setConfirmWordPress={setConfirmWordPress} runOperation={runOperation} refreshStatus={refreshStatus} validateRoutes={() => void validateRoutes()} loadRecentOutputs={() => { void loadRecentTelegramOutputs(); void loadTelegramQueue(); }} client={client} />}
      {activeTab === "activity" && <ActivityPage audit={audit} recentTelegramOutputs={recentTelegramOutputs} telegramQueueItems={telegramQueueItems} enabled={internalReady} busy={busy} loadActivity={loadActivity} loadRecentTelegramOutputs={() => void loadRecentTelegramOutputs()} loadTelegramQueue={() => void loadTelegramQueue()} />}
      {activeTab === "technical" && <TechnicalPage bundle={bundle} adminConfig={adminConfig} history={history} clearHistory={() => { clearOperationHistory(); setHistory([]); }} />}
    </main>
  );
}

function OverviewPage({ cards, onRefresh, busy }: { cards: ReturnType<typeof deriveOverviewCards>; onRefresh: () => void; busy: boolean }): JSX.Element {
  return <section className="pageStack"><PageHeader eyebrow="Overview" title="System status at a glance" text="Everything important, without the technical noise." action={<button type="button" onClick={onRefresh} disabled={busy}>Refresh</button>} /><div className="nextBanner"><strong>{nextRecommendedAction(cards)}</strong></div><div className="overviewCards">{cards.map((card) => <StatusCard key={card.title} {...card} />)}</div></section>;
}

function StatusCard({ title, label, explanation, nextAction }: ReturnType<typeof deriveOverviewCards>[number]): JSX.Element {
  return <article className="statusCard"><span className={`badge ${badgeTone(label)}`}>{label}</span><h3>{title}</h3><p>{explanation}</p><small>{nextAction}</small></article>;
}

function SetupPage(props: { steps: ReturnType<typeof buildWizardSteps>; activeStep: ReturnType<typeof buildWizardSteps>[number]; setActiveStep: (step: WizardStepId) => void; body: JSX.Element }): JSX.Element {
  const completeCount = props.steps.filter((step) => step.state === "complete" || step.state === "optional").length;
  return <section className="pageStack"><PageHeader eyebrow="Setup Wizard" title="One guided launch path" text="Complete one useful step at a time. Optional steps are clearly marked." /><div className="progress"><span>{completeCount} of {props.steps.length} steps complete or optional</span><div><i style={{ width: `${Math.round((completeCount / props.steps.length) * 100)}%` }} /></div></div><div className="wizardLayout"><aside className="stepRail">{props.steps.map((step) => <button type="button" key={step.id} className={step.id === props.activeStep.id ? "active" : "ghost"} onClick={() => props.setActiveStep(step.id)} disabled={step.state === "locked"}><span>{step.title}</span><small>{step.state}</small></button>)}</aside><div className="wizardCard"><h2>{props.activeStep.title}</h2>{props.activeStep.detail && <p className="muted">{props.activeStep.detail}</p>}{props.body}</div></div></section>;
}

function WizardBody(props: { id: WizardStepId; connectionFeedback: ConnectionFeedback; apiBaseUrlInput: string; setApiBaseUrlInput: (value: string) => void; credentialInput: string; setCredentialInput: (value: string) => void; saveAndCheckConnection: () => Promise<void>; clearLocalSettings: () => void; routeManagerSummary: TelegramRouteManagerSummary; workerReachable: boolean; internalReady: boolean; operatingMode: string; aiProvider: string; wordpressReady: boolean }): JSX.Element {
  const guidance = buildWizardGuidance({ id: props.id, workerReachable: props.workerReachable, hasAdminAccess: props.internalReady, operatingMode: props.operatingMode, aiProvider: props.aiProvider, wordpressReady: props.wordpressReady, routeManagerSummary: props.routeManagerSummary });
  return <div className="wizardContent"><GuidancePanel guidance={guidance} />{(props.id === "connect" || props.id === "admin") && <div className="panel"><label>Worker URL<input value={props.apiBaseUrlInput} onChange={(event) => props.setApiBaseUrlInput(event.target.value)} placeholder="https://your-worker.workers.dev" /></label><label>Admin access <span className="muted">INTERNAL_API_SECRET</span><input type="password" value={props.credentialInput} onChange={(event) => props.setCredentialInput(event.target.value)} placeholder="Enter for this page session" /></label><div className="buttonRow"><button type="button" onClick={() => void props.saveAndCheckConnection()}>Check connection</button><button type="button" className="secondary" onClick={props.clearLocalSettings}>Clear</button></div><ConnectionPanel feedback={props.connectionFeedback} /></div>}{props.id === "telegram" && <TelegramRouteManager summary={props.routeManagerSummary} compact />}</div>;
}

function GuidancePanel({ guidance }: { guidance: ReturnType<typeof buildWizardGuidance> }): JSX.Element {
  return <div className="panel"><h3>{guidance.title}</h3>{guidance.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}{guidance.bullets.length > 0 && <ul>{guidance.bullets.map((bullet) => <li key={bullet}>{bullet}</li>)}</ul>}{guidance.status.length > 0 && <div className="overviewCards">{guidance.status.map((item) => <StatusMini key={item.label} label={item.label} value={item.value} />)}</div>}</div>;
}

function SettingsPage(props: { internalReady: boolean; section: SettingsSection; setSection: (section: SettingsSection) => void; routeManagerSummary: TelegramRouteManagerSummary; onLoadRoutes: () => void; onValidateRoutes: () => void; routeSeedJson: string; setRouteSeedJson: (value: string) => void; onSaveRouteSeed: () => void; busy: boolean }): JSX.Element {
  return <section className="pageStack"><PageHeader eyebrow="Settings" title="Simple product controls" text="Telegram operations are shown as route cards, not raw database rows." />{!props.internalReady && <EmptyState title="Admin access needed" text="Enter admin access in Setup Wizard before managing routes." />}{props.internalReady && <div className="settingsLayout"><aside className="settingsSide">{(["telegram", "general", "activity", "technical"] as SettingsSection[]).map((section) => <button type="button" key={section} className={props.section === section ? "active" : "ghost"} onClick={() => props.setSection(section)}>{section === "telegram" ? "Telegram" : section === "general" ? "General" : section === "activity" ? "Activity" : "Technical"}</button>)}</aside><div className="settingsForm">{props.section === "telegram" ? <><div className="buttonRow"><button type="button" onClick={props.onLoadRoutes} disabled={props.busy}>Load routes</button><button type="button" className="secondary" onClick={props.onValidateRoutes} disabled={props.busy}>Check route config</button><button type="button" onClick={props.onSaveRouteSeed} disabled={props.busy}>Save route JSON</button></div><label>Route/output JSON<textarea value={props.routeSeedJson} onChange={(event) => props.setRouteSeedJson(event.target.value)} rows={14} /></label><TelegramRouteManager summary={props.routeManagerSummary} /></> : props.section === "technical" ? <p className="muted">Raw route payloads are available only in Technical. Normal Settings stay operator-friendly.</p> : <p className="muted">This build focuses on Telegram route operations polish.</p>}</div></div>}</section>;
}

function TelegramRouteManager({ summary, compact = false }: { summary: TelegramRouteManagerSummary; compact?: boolean }): JSX.Element {
  const botMissing = telegramBotMissingText(summary);
  return <div className="wizardContent"><div className="callout neutralSoft"><strong>{telegramRouteManagerCopy()}</strong><span>Use chat IDs and numeric topic IDs, not visible topic names.</span></div>{botMissing && <div className="callout warningSoft"><strong>Bot missing</strong><span>{botMissing}</span></div>}<div className="overviewCards"><StatusMini label="Bot" value={summary.botStatus} /><StatusMini label="Final publishing" value={summary.finalPublishing} /><StatusMini label="Routes" value={String(summary.routeCount)} /><StatusMini label="Enabled outputs" value={String(summary.enabledOutputCount)} /><StatusMini label="Media mode" value={summary.mediaMode} /><StatusMini label="WordPress" value={summary.wordpress} /></div>{!compact && <FormFieldSummary />}{summary.routeCards.length === 0 && <EmptyState title={telegramRoutesEmptyStateTitle()} text={telegramRoutesEmptyStateText(summary)} />}{summary.routeCards.map((route) => <article className="panel" key={`${route.sourceChatId}:${route.sourceThreadId}`}><div className="cardHeader"><span className={`badge ${route.enabledLabel === "Enabled" ? "safe" : "neutral"}`}>{route.enabledLabel}</span><h3>{route.category}</h3></div><p>Source chat: <code>{route.sourceChatId}</code> · Topic ID: <code>{route.sourceThreadId}</code></p><p>Prompt profile: <code>{route.promptProfile}</code></p><p>{route.outputsCount} output{route.outputsCount === 1 ? "" : "s"}</p>{route.warnings.map((warning) => <p className="warningText" key={warning}>{warning}</p>)}<div className="grid two">{route.outputs.map((output) => <div className="callout neutralSoft" key={`${route.category}:${output.language}:${output.finalChatId}`}><strong>{output.language.toUpperCase()} · {output.enabledLabel}</strong><span>Review: {output.reviewChatId} / topic {output.reviewThreadId}</span><span>Final: {output.finalChatId}{output.finalThreadId === undefined ? "" : ` / topic ${output.finalThreadId}`}</span><span>Status: {output.latestStatus}</span><span>Publish: {output.publishEnabledLabel} · {output.publishMode}</span><span>Schedule: {output.timezone} · gap {output.minimumGapMinutes}m · {output.allowedPublishWindows.length === 0 ? "anytime" : output.allowedPublishWindows.join(", ")}</span><span>Limits: {output.maxPostsPerHour}/hour · {output.maxPostsPerDay}/day · priority {output.queuePriority}</span></div>)}</div></article>)}</div>;
}

function FormFieldSummary(): JSX.Element {
  return <details className="panel"><summary>Route form guide</summary><div className="grid two"><div>{TELEGRAM_ROUTE_FORM_FIELDS.map((field) => <p key={field.label}><strong>{field.label}</strong><br /><span className="muted">{field.helper}</span></p>)}</div><div>{TELEGRAM_OUTPUT_FORM_FIELDS.map((field) => <p key={field.label}><strong>{field.label}</strong><br /><span className="muted">{field.helper}</span></p>)}</div></div></details>;
}

function StatusMini({ label, value }: { label: string; value: string }): JSX.Element {
  return <article className="statusCard"><small>{label}</small><h3>{value}</h3></article>;
}

function TestsPage(props: { internalReady: boolean; busy: string | undefined; latest: OperationRecord[]; telegramText: string; setTelegramText: (value: string) => void; wordpressTitle: string; setWordpressTitle: (value: string) => void; wordpressContent: string; setWordpressContent: (value: string) => void; confirmTelegram: boolean; setConfirmTelegram: (value: boolean) => void; confirmWordPress: boolean; setConfirmWordPress: (value: boolean) => void; runOperation: (name: OperationName, runner: () => Promise<ApiResult>, confirmText?: string) => Promise<void>; refreshStatus: () => Promise<void>; validateRoutes: () => void; loadRecentOutputs: () => void; client: WorkerApiClient }): JSX.Element {
  return <section className="pageStack"><PageHeader eyebrow="Tests" title="Safe checks only" text="No final publishing, no public publishing, and no scheduler publishing controls." /><div className="testGrid">{SAFE_TESTS.map((test) => <article className="testCard" key={test.id}><span className={`badge ${test.safety === "Safe" ? "safe" : "warning"}`}>{test.safety}</span><h3>{test.title}</h3><p>{test.description}</p><small>{test.external}</small><small>{test.publishes}</small>{test.id === "readiness" && <button type="button" onClick={() => void props.refreshStatus()} disabled={props.busy !== undefined}>Run readiness check</button>}{test.id === "mock_e2e" && <button type="button" onClick={() => void props.runOperation("mock_e2e_smoke", () => props.client.runMockE2E())} disabled={!props.internalReady || props.busy !== undefined}>Run mock E2E</button>}{test.id === "telegram_route_config" && <button type="button" onClick={props.validateRoutes} disabled={!props.internalReady || props.busy !== undefined}>Check route config</button>}{test.id === "telegram_publish_queue_dry_run" && <button type="button" onClick={props.loadRecentOutputs} disabled={!props.internalReady || props.busy !== undefined}>Load queue status</button>}{test.id === "telegram_review" && <><textarea value={props.telegramText} onChange={(event) => props.setTelegramText(event.target.value)} /><label className="checkRow"><input type="checkbox" checked={props.confirmTelegram} onChange={(event) => props.setConfirmTelegram(event.target.checked)} />I understand this is review-only.</label><button type="button" onClick={() => void props.runOperation("telegram_review_dry_run", () => props.client.runTelegramReviewDryRun({ text: props.telegramText }), "Run Telegram review dry-run?")} disabled={!props.internalReady || !props.confirmTelegram || props.busy !== undefined}>Run review dry-run</button></>}{test.id === "wordpress_draft" && <><input value={props.wordpressTitle} onChange={(event) => props.setWordpressTitle(event.target.value)} /><textarea value={props.wordpressContent} onChange={(event) => props.setWordpressContent(event.target.value)} /><label className="checkRow"><input type="checkbox" checked={props.confirmWordPress} onChange={(event) => props.setConfirmWordPress(event.target.checked)} />I understand this creates draft-only output.</label><button type="button" onClick={() => void props.runOperation("wordpress_draft_dry_run", () => props.client.runWordPressDraftDryRun({ title: props.wordpressTitle, content: props.wordpressContent }), "Run WordPress draft dry-run?")} disabled={!props.internalReady || !props.confirmWordPress || props.busy !== undefined}>Run draft dry-run</button></>}<LatestResult records={props.latest} title={test.title} /></article>)}</div></section>;
}

function ActivityPage({ audit, recentTelegramOutputs, telegramQueueItems, enabled, busy, loadActivity, loadRecentTelegramOutputs, loadTelegramQueue }: { audit: AdminAuditEntry[]; recentTelegramOutputs: RecentTelegramOutput[]; telegramQueueItems: TelegramQueueItem[]; enabled: boolean; busy: string | undefined; loadActivity: () => Promise<void>; loadRecentTelegramOutputs: () => void; loadTelegramQueue: () => void }): JSX.Element {
  return <section className="pageStack"><PageHeader eyebrow="Activity" title="Recent Telegram outputs, queue, and changes" text="Operational status stays readable. Raw payloads stay in Technical." action={<div className="buttonRow"><button type="button" onClick={loadRecentTelegramOutputs} disabled={!enabled || busy !== undefined}>Load Telegram outputs</button><button type="button" className="secondary" onClick={loadTelegramQueue} disabled={!enabled || busy !== undefined}>Load publish queue</button><button type="button" className="secondary" onClick={() => void loadActivity()} disabled={!enabled || busy !== undefined}>Load audit</button></div>} />{!enabled && <EmptyState title="Admin access needed" text="Save admin access in Setup Wizard to load activity." />}<div className="grid two">{recentTelegramOutputs.map((output) => <article className="activityItem" key={`${output.itemId}:${output.language}:${output.updatedAt}`}><div><span className="badge neutral">{output.language}</span><h3>{output.category}</h3><p>Item: {output.itemId}</p><p>Review: {output.reviewStatus} · Queue: {output.publishQueueStatus}</p><p>Final: {output.finalChatId}</p>{output.lastError !== "none" && output.lastError.length > 0 && <p className="warningText">{output.lastError}</p>}<small>{output.updatedAt}</small></div></article>)}</div><h3>Publish queue</h3><div className="grid two">{telegramQueueItems.map((item) => <article className="activityItem" key={item.queueId}><div><span className="badge neutral">{item.language}</span><h3>{item.status}</h3><p>Output: {item.generatedOutputId}</p><p>Final: {item.finalChatId}</p><p>Scheduled: {item.scheduledFor}</p><p>Priority: {item.priority} · Attempts: {item.attemptCount}</p>{item.lastError !== "none" && item.lastError.length > 0 && <p className="warningText">{item.lastError}</p>}<small>{item.updatedAt}</small></div></article>)}</div>{audit.map((entry) => <article className="activityItem" key={entry.id}><div><span className="badge neutral">{entry.action}</span><h3>{entry.key}</h3><p>{new Date(entry.changed_at).toLocaleString()}</p></div><div className="auditValues"><span>Previous: {entry.previous_value_redacted ?? "[missing]"}</span><span>New: {entry.new_value_redacted ?? "[missing]"}</span></div></article>)}</section>;
}

function TechnicalPage({ bundle, adminConfig, history, clearHistory }: { bundle: StatusBundle; adminConfig: AdminConfigResponse | undefined; history: OperationRecord[]; clearHistory: () => void }): JSX.Element {
  return <section className="pageStack"><PageHeader eyebrow="Technical" title="Debugging details" text="Raw payloads and troubleshooting information live here only." action={<button type="button" className="secondary" onClick={clearHistory}>Clear history</button>} /><details className="panel" open><summary>Raw /status and /ready</summary><div className="grid two"><JsonPanel title="/health" result={bundle.health} /><JsonPanel title="/status" result={bundle.status} /><JsonPanel title="/ready" result={bundle.ready} /></div></details><details className="panel"><summary>Raw Telegram topic workflow routes</summary><pre>{JSON.stringify(redactSensitiveJson((readObject(readObject(bundle.status?.ok === true ? bundle.status.data : undefined, "telegram"), "topicWorkflow") ?? null) as JsonValue), null, 2)}</pre></details><details className="panel"><summary>Raw admin config</summary><pre>{JSON.stringify(redactSensitiveJson((adminConfig ?? null) as JsonValue), null, 2)}</pre></details><details className="panel"><summary>Raw test output</summary><RecentResults history={history} /></details></section>;
}

function PageHeader({ eyebrow, title, text, action }: { eyebrow: string; title: string; text: string; action?: JSX.Element }): JSX.Element { return <div className="pageHeader"><div><p className="eyebrow">{eyebrow}</p><h2>{title}</h2><p>{text}</p></div>{action}</div>; }
function EmptyState({ title, text }: { title: string; text: string }): JSX.Element { return <div className="emptyState"><h3>{title}</h3><p>{text}</p></div>; }
function ConnectionPanel({ feedback }: { feedback: ConnectionFeedback }): JSX.Element { return <div className={`callout ${feedback.state === "connected" ? "safeSoft" : "warningSoft"}`}><strong>{feedback.title}</strong><span>{feedback.detail}</span>{feedback.guidance.map((item) => <small key={item}>{item}</small>)}</div>; }
function LatestResult({ records, title }: { records: OperationRecord[]; title: string }): JSX.Element | null { const record = records.find((entry) => entry.label === title); return record ? <small>Latest: {record.ok ? "OK" : "Needs attention"}</small> : null; }
function RecentResults({ history }: { history: OperationRecord[] }): JSX.Element { return <div>{history.map((record) => <details key={record.id}><summary>{record.label} · {record.ok ? "OK" : "Error"}</summary><pre>{JSON.stringify(record.result, null, 2)}</pre></details>)}</div>; }
function JsonPanel({ title, result }: { title: string; result: ApiResult | undefined }): JSX.Element { return <div><h3>{title}</h3><pre>{JSON.stringify(result ?? null, null, 2)}</pre></div>; }
function badgeTone(value: string): string { return value === "Connected" || value === "Safe" ? "safe" : value === "Optional" ? "neutral" : "warning"; }
function feedbackFromBundle(bundle: StatusBundle): ConnectionFeedback { const state = describeConnectionBundle(bundle); if (state === "connected") return { state, title: "Worker connected", detail: "Worker health, status, and readiness are reachable.", guidance: [] }; if (state === "reachable_not_ready") return { state, title: "Worker reachable, setup incomplete", detail: "The Worker responded, but readiness has warnings.", guidance: ["Open Setup Wizard.", "Check Technical for raw readiness details."] }; if (state === "cors_blocked") return { state, title: "Browser blocked the request", detail: "Likely CORS or network configuration.", guidance: connectionGuidance() }; return { state, title: "Worker unreachable", detail: "The dashboard could not reach the Worker.", guidance: connectionGuidance() }; }
function connectionGuidance(): string[] { return ["Use the deployed Worker URL, including https://.", "For local development, use http://localhost:8787.", "Check CORS settings if the Worker opens but dashboard calls fail."]; }
function resultToJson(result: ApiResult | undefined): JsonValue {
  if (result === undefined) return null;
  if (result.ok) return result.data;
  const payload: JsonObject = { error: result.error, message: result.message };
  if (typeof result.status === "number") payload.status = result.status;
  if (result.data !== undefined) payload.data = result.data;
  return payload;
}
function readObject(value: unknown, key: string): JsonObject | undefined { return typeof value === "object" && value !== null && !Array.isArray(value) && typeof (value as JsonObject)[key] === "object" && (value as JsonObject)[key] !== null && !Array.isArray((value as JsonObject)[key]) ? (value as JsonObject)[key] as JsonObject : undefined; }
function readString(value: unknown, key: string): string | undefined { const record = typeof value === "object" && value !== null && !Array.isArray(value) ? value as JsonObject : undefined; const raw = record?.[key]; return typeof raw === "string" ? raw : undefined; }
function readBoolean(value: unknown, key: string): boolean | undefined { const record = typeof value === "object" && value !== null && !Array.isArray(value) ? value as JsonObject : undefined; const raw = record?.[key]; return typeof raw === "boolean" ? raw : undefined; }

const defaultRouteSeedJson = JSON.stringify([
  {
    id: "crypto",
    category: "crypto",
    sourceChatId: "-1001111111111",
    sourceThreadId: 101,
    promptProfile: "crypto_editorial",
    enabled: true,
    outputs: [
      { id: "crypto_fa", language: "fa", reviewChatId: "-1001111111111", reviewThreadId: 201, finalChatId: "@crypto_fa", publishMode: "scheduled", timezone: "Asia/Tehran", allowedPublishWindows: ["09:00-23:00"], minimumGapMinutes: 10, maxPostsPerHour: 4, maxPostsPerDay: 24, queuePriority: 0, enabled: true },
      { id: "crypto_ar", language: "ar", reviewChatId: "-1001111111111", reviewThreadId: 202, finalChatId: "@crypto_ar", publishMode: "scheduled", timezone: "Asia/Dubai", allowedPublishWindows: ["10:00-23:00"], minimumGapMinutes: 10, maxPostsPerHour: 4, maxPostsPerDay: 24, queuePriority: 0, enabled: true },
      { id: "crypto_en", language: "en", reviewChatId: "-1001111111111", reviewThreadId: 203, finalChatId: "@crypto_en", publishMode: "scheduled", timezone: "UTC", allowedPublishWindows: ["08:00-22:00"], minimumGapMinutes: 15, maxPostsPerHour: 3, maxPostsPerDay: 24, queuePriority: 0, enabled: true }
    ]
  }
], null, 2);

export default App;
