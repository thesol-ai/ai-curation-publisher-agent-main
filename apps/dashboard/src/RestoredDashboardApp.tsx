import { useCallback, useEffect, useMemo, useState } from "react";
import { AdminConfigEditor, adminConfigGroupOrder, ADMIN_CONFIG_GROUP_LABELS } from "./admin-config-editor";
import { TelegramRouteQuickForm } from "./TelegramRouteQuickForm";
import { describeConnectionBundle, validateWorkerBaseUrl, WorkerApiClient } from "./api";
import { buildWizardSteps, DASHBOARD_TABS, deriveOverviewCards, nextRecommendedAction, type DashboardTab, type WizardStepId } from "./dashboard-ux";
import { buildTelegramRouteManagerSummary, summarizeRecentTelegramOutputs, summarizeTelegramPublishQueue, summarizeMediaJobs, telegramBotMissingText, telegramRouteManagerCopy, telegramRoutesEmptyStateText, telegramRoutesEmptyStateTitle, TELEGRAM_OUTPUT_FORM_FIELDS, TELEGRAM_ROUTE_FORM_FIELDS, type TelegramRouteManagerSummary } from "./telegram-route-manager";
import { redactSensitiveJson } from "./setup";
import { countErrors, countWarnings } from "./status";
import { clearOperationHistory, clearSettings, getInternalCredential, loadOperationHistory, loadSettings, saveApiBaseUrl, saveInternalCredential, saveOperationRecord } from "./storage";
import type { AdminAuditEntry, AdminConfigGroup, AdminConfigResponse, ApiResult, ConnectionFeedback, DashboardSettings, JsonObject, JsonValue, OperationName, OperationRecord, StatusBundle } from "./types";
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

type SettingsSection = AdminConfigGroup | "activity" | "technical";
type RecentTelegramOutput = ReturnType<typeof summarizeRecentTelegramOutputs>[number];
type TelegramQueueItem = ReturnType<typeof summarizeTelegramPublishQueue>[number];
type MediaJobItem = ReturnType<typeof summarizeMediaJobs>[number];

const idleConnectionFeedback: ConnectionFeedback = {
  state: "idle",
  title: "Connection not checked",
  detail: "Enter the Worker URL, then save and check the connection.",
  guidance: ["Use the deployed workers.dev URL.", "The Worker URL is stored locally and is not sensitive."]
};

const DEFAULT_TELEGRAM_ROUTE_SEED = JSON.stringify([
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

export default function RestoredDashboardApp(): JSX.Element {
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
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("ai");
  const [routeManagerData, setRouteManagerData] = useState<JsonObject | undefined>();
  const [routeSeedInput, setRouteSeedInput] = useState(DEFAULT_TELEGRAM_ROUTE_SEED);
  const [recentTelegramOutputs, setRecentTelegramOutputs] = useState<RecentTelegramOutput[]>([]);
  const [telegramQueueItems, setTelegramQueueItems] = useState<TelegramQueueItem[]>([]);
  const [mediaJobs, setMediaJobs] = useState<MediaJobItem[]>([]);
  const [adminSummary, setAdminSummary] = useState<JsonObject | undefined>();
  const [adminValidation, setAdminValidation] = useState<JsonObject | undefined>();
  const [adminExport, setAdminExport] = useState<JsonObject | undefined>();

  const client = useMemo(() => new WorkerApiClient(settings.apiBaseUrl, getInternalCredential()), [settings]);
  const workerReachable = bundle.health?.ok === true && bundle.status?.ok === true;
  const internalReady = settings.hasInternalCredential;
  const topicWorkflow = readObject(readObject(bundle.status?.ok === true ? bundle.status.data : undefined, "telegram"), "topicWorkflow") ?? readObject(readObject(bundle.ready?.ok === true ? bundle.ready.data : undefined, "summary"), "telegramTopicWorkflow");
  const routeManagerSummary = buildTelegramRouteManagerSummary(routeManagerData ?? topicWorkflow);
  const operatingMode = readString(bundle.status?.ok === true ? bundle.status.data : undefined, "operatingMode") ?? readAdminConfigValue(adminConfig, "OPERATING_MODE") ?? "manual_only";
  const aiProvider = readString(readObject(bundle.status?.ok === true ? bundle.status.data : undefined, "ai"), "provider") ?? readAdminConfigValue(adminConfig, "AI_PROVIDER") ?? "mock";
  const telegramReady = routeManagerSummary.routeCount > 0 || readBoolean(readObject(bundle.ready?.ok === true ? bundle.ready.data : undefined, "summary"), "hasTelegramConfig") === true;
  const wordpressReady = readBoolean(readObject(bundle.ready?.ok === true ? bundle.ready.data : undefined, "summary"), "hasWordPressConfig") === true;
  const providersOptional = operatingMode === "manual_only" || operatingMode === "mock_demo";
  const schedulerSafe = readBoolean(readObject(bundle.ready?.ok === true ? bundle.ready.data : undefined, "summary"), "setupSafe") !== false;
  const deliverySafe = routeManagerSummary.finalPublishing === "Disabled";
  const overviewCards = deriveOverviewCards({ workerReachable, hasAdminAccess: internalReady, operatingMode, aiProvider, telegramReady, wordpressReady, providersOptional, schedulerSafe, publishingSafe: deliverySafe });
  const wizardSteps = buildWizardSteps({ workerReachable, hasAdminAccess: internalReady, operatingMode, aiReady: aiProvider !== "mock", telegramReady, wordpressReady, providersReady: providersOptional, routeCount: routeManagerSummary.routeCount, outputCount: routeManagerSummary.enabledOutputCount, finalPublishingEnabled: routeManagerSummary.finalPublishing === "Enabled" });
  const activeWizardStep = wizardSteps.find((step) => step.id === activeStep) ?? wizardSteps[0]!;

  const recordOperation = useCallback((name: OperationName, ok: boolean, result: JsonValue): void => {
    const safeResult = redactSensitiveJson(result);
    setHistory(saveOperationRecord({ id: `${Date.now()}-${name}`, name, label: operationLabels[name], timestamp: new Date().toISOString(), ok, warningsCount: countWarnings(safeResult), errorsCount: countErrors(safeResult), result: safeResult }));
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

  useEffect(() => { if (settings.apiBaseUrl.length > 0) void refreshStatus(); }, [refreshStatus, settings.apiBaseUrl]);
  useEffect(() => { if (internalReady) { void loadAdminConfig(); void loadRouteManager(); void loadRecentTelegramOutputs(); void loadTelegramQueue(); void loadMediaJobs(); void loadDiagnostics(); } }, [internalReady, settings.apiBaseUrl]);

  async function saveAndCheckConnection(): Promise<void> {
    const valid = validateWorkerBaseUrl(apiBaseUrlInput);
    if (!valid.ok) { setConnectionFeedback({ state: "invalid_url", title: "Invalid Worker URL", detail: valid.message, guidance: connectionGuidance() }); setNotice("Invalid Worker URL"); return; }
    saveApiBaseUrl(valid.value);
    if (credentialInput.trim().length > 0) saveInternalCredential(credentialInput, false);
    setCredentialInput("");
    setSettings(loadSettings());
    await refreshStatus();
  }

  async function loadAdminConfig(): Promise<void> {
    if (!internalReady) return;
    setBusy("admin_config_load");
    const response = await client.getAdminConfig();
    recordOperation("admin_config_load", response.ok, resultToJson(response));
    if (response.ok) { setAdminConfig(response.data); setNotice("Settings loaded."); } else { setNotice(response.message); }
    setBusy(undefined);
  }

  async function saveSetting(key: string, value: string): Promise<void> {
    if (!internalReady) return;
    setBusy("admin_config_save");
    const response = await client.saveAdminConfig([{ key, value }]);
    recordOperation("admin_config_save", response.ok, resultToJson(response));
    if (response.ok) { setAdminConfig(response.data); setNotice(`${key} saved.`); await refreshStatus(); } else { setNotice(response.message); }
    setBusy(undefined);
  }

  async function resetSetting(key: string): Promise<void> {
    if (!internalReady) return;
    setBusy("admin_config_reset");
    const response = await client.resetAdminConfig([key]);
    recordOperation("admin_config_reset", response.ok, resultToJson(response));
    if (response.ok) { setAdminConfig(response.data); setNotice(`${key} reset.`); await refreshStatus(); } else { setNotice(response.message); }
    setBusy(undefined);
  }

  async function loadRouteManager(): Promise<void> {
    if (!internalReady) return;
    setBusy("telegram_route_config");
    const response = await client.getTelegramTopicRoutes();
    recordOperation("refresh_status", response.ok, resultToJson(response));
    if (response.ok) { setRouteManagerData(response.data); setNotice("Telegram routes loaded."); } else { setNotice(response.message); }
    setBusy(undefined);
  }

  async function loadRecentTelegramOutputs(): Promise<void> {
    if (!internalReady) return;
    setBusy("telegram_outputs_recent");
    const response = await client.getRecentTelegramOutputs(50);
    recordOperation("refresh_status", response.ok, resultToJson(response));
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
    recordOperation("refresh_status", response.ok, resultToJson(response));
    if (response.ok) {
      setTelegramQueueItems(summarizeTelegramPublishQueue(response.data.queue));
      setNotice("Telegram publish queue loaded.");
    } else {
      setNotice(response.message);
    }
    setBusy(undefined);
  }

  async function loadMediaJobs(): Promise<void> {
    if (!internalReady) return;
    setBusy("media_jobs");
    const response = await client.getMediaJobs(25);
    recordOperation("refresh_status", response.ok, resultToJson(response));
    if (response.ok) {
      setMediaJobs(summarizeMediaJobs(response.data.jobs));
      setNotice("Media jobs loaded.");
    } else {
      setNotice(response.message);
    }
    setBusy(undefined);
  }

  async function loadDiagnostics(): Promise<void> {
    if (!internalReady) return;
    setBusy("admin_diagnostics");
    const [summary, validation] = await Promise.all([client.getAdminSummary(), client.getAdminValidation()]);
    recordOperation("refresh_status", summary.ok && validation.ok, { summary: resultToJson(summary), validation: resultToJson(validation) });
    if (summary.ok) setAdminSummary(summary.data);
    if (validation.ok) setAdminValidation(validation.data);
    setNotice(summary.ok && validation.ok ? "Diagnostics loaded." : "Diagnostics need attention.");
    setBusy(undefined);
  }

  async function exportConfig(): Promise<void> {
    if (!internalReady) return;
    setBusy("admin_config_export");
    const response = await client.exportAdminConfig();
    recordOperation("refresh_status", response.ok, resultToJson(response));
    if (response.ok) {
      setAdminExport(response.data);
      setNotice("Safe config export loaded. Secrets are excluded.");
    } else {
      setNotice(response.message);
    }
    setBusy(undefined);
  }

  async function runDuePublish(): Promise<void> {
    if (!internalReady) return;
    setBusy("telegram_publish_due");
    const response = await client.runTelegramPublishDue(5);
    recordOperation("scheduler_dry_run", response.ok, resultToJson(response));
    setNotice(response.ok ? "Due Telegram publish runner completed." : response.message);
    await loadTelegramQueue();
    await loadRecentTelegramOutputs();
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

  async function seedRoutesFromInput(): Promise<void> {
    if (!internalReady) return;
    let routes: JsonValue;
    try {
      routes = JSON.parse(routeSeedInput) as JsonValue;
      if (!Array.isArray(routes)) {
        setNotice("Route seed JSON must be an array of routes.");
        return;
      }
    } catch {
      setNotice("Route seed JSON is invalid.");
      return;
    }
    setBusy("telegram_route_config");
    const response = await client.seedTelegramTopicRoutes(routes);
    recordOperation("admin_config_save", response.ok, resultToJson(response));
    setNotice(response.ok ? "Telegram routes saved from dashboard." : response.message);
    await loadRouteManager();
    setBusy(undefined);
  }

  async function saveRouteBundleFromBuilder(routes: JsonValue): Promise<void> {
    if (!internalReady) return;
    setBusy("telegram_route_config");
    const response = await client.seedTelegramTopicRoutes(routes);
    recordOperation("admin_config_save", response.ok, resultToJson(response));
    setNotice(response.ok ? "Telegram route saved from form." : response.message);
    await loadRouteManager();
    setBusy(undefined);
  }

  async function loadActivity(): Promise<void> {
    if (!internalReady) { setNotice("Admin access is needed first."); return; }
    setBusy("admin_config_audit");
    const response = await client.getAdminConfigAudit();
    if (response.ok) { setAudit(response.data.entries); setNotice("Activity loaded."); } else { setNotice(response.message); }
    setBusy(undefined);
  }

  function clearLocalSettings(): void { clearSettings(); setApiBaseUrlInput(""); setCredentialInput(""); setSettings(loadSettings()); setConnectionFeedback(idleConnectionFeedback); setNotice("Local dashboard settings cleared."); }

  return <main className="shell"><header className="hero"><div><p className="eyebrow">Operator Dashboard</p><h1>Launch and manage safely.</h1><p>A guided admin console for setup, editable settings, Telegram routing, safe checks, and activity review.</p></div><div className="heroPanel"><span>Scheduler guarded</span><span>Live delivery guarded</span><span>Secrets hidden</span></div></header>{notice && <div className="notice">{notice}</div>}<nav className="topTabs" aria-label="Dashboard sections">{DASHBOARD_TABS.map((tab) => <button type="button" key={tab.id} className={activeTab === tab.id ? "active" : "secondary"} onClick={() => setActiveTab(tab.id)}>{tab.label}</button>)}</nav>{activeTab === "overview" && <OverviewPage cards={overviewCards} onRefresh={() => void refreshStatus()} busy={busy !== undefined} />}{activeTab === "setup" && <SetupPage steps={wizardSteps} activeStep={activeWizardStep} setActiveStep={setActiveStep} body={<WizardBody id={activeWizardStep.id} connectionFeedback={connectionFeedback} apiBaseUrlInput={apiBaseUrlInput} setApiBaseUrlInput={setApiBaseUrlInput} credentialInput={credentialInput} setCredentialInput={setCredentialInput} saveAndCheckConnection={saveAndCheckConnection} clearLocalSettings={clearLocalSettings} routeManagerSummary={routeManagerSummary} workerReachable={workerReachable} internalReady={internalReady} operatingMode={operatingMode} aiProvider={aiProvider} wordpressReady={wordpressReady} />} />}{activeTab === "settings" && <SettingsPage internalReady={internalReady} section={settingsSection} setSection={setSettingsSection} adminConfig={adminConfig} routeManagerSummary={routeManagerSummary} onLoadSettings={() => void loadAdminConfig()} onSaveSetting={saveSetting} onResetSetting={resetSetting} onLoadRoutes={() => void loadRouteManager()} onValidateRoutes={() => void validateRoutes()} routeSeedInput={routeSeedInput} setRouteSeedInput={setRouteSeedInput} onSeedRoutes={() => void seedRoutesFromInput()} onSaveRouteBundle={(routes) => saveRouteBundleFromBuilder(routes)} busy={busy !== undefined} />}{activeTab === "diagnostics" && <DiagnosticsPage enabled={internalReady} busy={busy} summary={adminSummary} validation={adminValidation} configExport={adminExport} loadDiagnostics={() => void loadDiagnostics()} exportConfig={() => void exportConfig()} />}{activeTab === "tests" && <TestsPage internalReady={internalReady} busy={busy} history={history} refreshStatus={() => void refreshStatus()} validateRoutes={() => void validateRoutes()} />}{activeTab === "activity" && <ActivityPage audit={audit} recentTelegramOutputs={recentTelegramOutputs} telegramQueueItems={telegramQueueItems} mediaJobs={mediaJobs} enabled={internalReady} busy={busy} loadActivity={loadActivity} loadRecentTelegramOutputs={() => void loadRecentTelegramOutputs()} loadTelegramQueue={() => void loadTelegramQueue()} loadMediaJobs={() => void loadMediaJobs()} runDuePublish={() => void runDuePublish()} />}{activeTab === "technical" && <TechnicalPage bundle={bundle} adminConfig={adminConfig} history={history} clearHistory={() => { clearOperationHistory(); setHistory([]); }} />}</main>;
}

function OverviewPage({ cards, onRefresh, busy }: { cards: ReturnType<typeof deriveOverviewCards>; onRefresh: () => void; busy: boolean }): JSX.Element { return <section className="pageStack"><PageHeader eyebrow="Overview" title="System status at a glance" text="Everything important, without the technical noise." action={<button type="button" onClick={onRefresh} disabled={busy}>Refresh</button>} /><div className="nextBanner"><strong>{nextRecommendedAction(cards)}</strong></div><div className="overviewCards">{cards.map((card) => <StatusCard key={card.title} {...card} />)}</div></section>; }
function StatusCard({ title, label, explanation, nextAction }: ReturnType<typeof deriveOverviewCards>[number]): JSX.Element { return <article className="statusCard"><span className={`badge ${badgeTone(label)}`}>{label}</span><h3>{title}</h3><p>{explanation}</p><small>{nextAction}</small></article>; }
function SetupPage(props: { steps: ReturnType<typeof buildWizardSteps>; activeStep: ReturnType<typeof buildWizardSteps>[number]; setActiveStep: (step: WizardStepId) => void; body: JSX.Element }): JSX.Element { const completeCount = props.steps.filter((step) => step.state === "complete" || step.state === "optional").length; return <section className="pageStack"><PageHeader eyebrow="Setup Wizard" title="One guided launch path" text="Complete one useful step at a time. Optional steps are clearly marked." /><div className="progress"><span>{completeCount} of {props.steps.length} steps complete or optional</span><div><i style={{ width: `${Math.round((completeCount / props.steps.length) * 100)}%` }} /></div></div><div className="wizardLayout"><aside className="stepRail">{props.steps.map((step) => <button type="button" key={step.id} className={step.id === props.activeStep.id ? "active" : "ghost"} onClick={() => props.setActiveStep(step.id)} disabled={step.state === "locked"}><span>{step.title}</span><small>{step.state}</small></button>)}</aside><div className="wizardCard"><h2>{props.activeStep.title}</h2>{props.activeStep.detail && <p className="muted">{props.activeStep.detail}</p>}{props.body}</div></div></section>; }
function WizardBody(props: { id: WizardStepId; connectionFeedback: ConnectionFeedback; apiBaseUrlInput: string; setApiBaseUrlInput: (value: string) => void; credentialInput: string; setCredentialInput: (value: string) => void; saveAndCheckConnection: () => Promise<void>; clearLocalSettings: () => void; routeManagerSummary: TelegramRouteManagerSummary; workerReachable: boolean; internalReady: boolean; operatingMode: string; aiProvider: string; wordpressReady: boolean }): JSX.Element { const guidance = buildWizardGuidance({ id: props.id, workerReachable: props.workerReachable, hasAdminAccess: props.internalReady, operatingMode: props.operatingMode, aiProvider: props.aiProvider, wordpressReady: props.wordpressReady, routeManagerSummary: props.routeManagerSummary }); return <div className="wizardContent"><GuidancePanel guidance={guidance} />{(props.id === "connect" || props.id === "admin") && <div className="panel"><label>Worker URL<input value={props.apiBaseUrlInput} onChange={(event) => props.setApiBaseUrlInput(event.target.value)} placeholder="https://your-worker.workers.dev" /></label><label>Admin access <span className="muted">INTERNAL_API_SECRET</span><input type="password" value={props.credentialInput} onChange={(event) => props.setCredentialInput(event.target.value)} placeholder="Enter for this page session" /></label><div className="buttonRow"><button type="button" onClick={() => void props.saveAndCheckConnection()}>Check connection</button><button type="button" className="secondary" onClick={props.clearLocalSettings}>Clear</button></div><ConnectionPanel feedback={props.connectionFeedback} /></div>}{props.id === "telegram" && <TelegramRouteManager summary={props.routeManagerSummary} compact />}</div>; }
function GuidancePanel({ guidance }: { guidance: ReturnType<typeof buildWizardGuidance> }): JSX.Element { return <div className="panel"><h3>{guidance.title}</h3>{guidance.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}{guidance.bullets.length > 0 && <ul>{guidance.bullets.map((bullet) => <li key={bullet}>{bullet}</li>)}</ul>}{guidance.status.length > 0 && <div className="overviewCards">{guidance.status.map((item) => <StatusMini key={item.label} label={item.label} value={item.value} />)}</div>}</div>; }
function SettingsPage(props: { internalReady: boolean; section: SettingsSection; setSection: (section: SettingsSection) => void; adminConfig: AdminConfigResponse | undefined; routeManagerSummary: TelegramRouteManagerSummary; onLoadSettings: () => void; onSaveSetting: (key: string, value: string) => Promise<void>; onResetSetting: (key: string) => Promise<void>; onLoadRoutes: () => void; onValidateRoutes: () => void; routeSeedInput: string; setRouteSeedInput: (value: string) => void; onSeedRoutes: () => void; onSaveRouteBundle: (routes: JsonValue) => Promise<void>; busy: boolean }): JSX.Element { const sections: SettingsSection[] = [...adminConfigGroupOrder(), "activity", "technical"]; return <section className="pageStack"><PageHeader eyebrow="Settings" title="Configuration editor" text="Edit runtime settings here. Telegram routes stay inside Telegram settings instead of replacing the editor." action={<button type="button" onClick={props.onLoadSettings} disabled={!props.internalReady || props.busy}>Load settings</button>} />{!props.internalReady && <EmptyState title="Admin access needed" text="Enter admin access in Setup Wizard before editing settings." />}{props.internalReady && <div className="settingsLayout"><aside className="settingsSide">{sections.map((section) => <button type="button" key={section} className={props.section === section ? "active" : "ghost"} onClick={() => props.setSection(section)}>{isAdminGroup(section) ? ADMIN_CONFIG_GROUP_LABELS[section] : section === "activity" ? "Activity" : "Technical"}</button>)}</aside><div className="settingsForm">{isAdminGroup(props.section) && <AdminConfigEditor config={props.adminConfig} activeGroup={props.section} busy={props.busy} onSave={props.onSaveSetting} onReset={props.onResetSetting} />}{props.section === "telegram" && <><div className="buttonRow"><button type="button" onClick={props.onLoadRoutes} disabled={props.busy}>Load routes</button><button type="button" className="secondary" onClick={props.onValidateRoutes} disabled={props.busy}>Check route config</button></div><TelegramRouteQuickForm busy={props.busy} onSave={props.onSaveRouteBundle} /><TelegramRouteManager summary={props.routeManagerSummary} /></>}{props.section === "activity" && <p className="muted">Use the Activity tab for audit entries.</p>}{props.section === "technical" && <p className="muted">Raw payloads are available only in Technical.</p>}</div></div>}</section>; }

function RouteSeedEditor({ value, onChange, onSave, busy }: { value: string; onChange: (value: string) => void; onSave: () => void; busy: boolean }): JSX.Element {
  return <details className="panel"><summary>Advanced route JSON</summary><p className="muted">Paste an array of route objects with nested outputs. Saving writes real Worker/D1 route rows.</p><textarea rows={12} value={value} onChange={(event: any) => onChange(event.target.value)} /><div className="buttonRow"><button type="button" onClick={onSave} disabled={busy}>Save route JSON</button></div></details>;
}

function TelegramRouteManager({ summary, compact = false }: { summary: TelegramRouteManagerSummary; compact?: boolean }): JSX.Element {
  const botMissing = telegramBotMissingText(summary);
  return <div className="wizardContent"><div className="callout neutralSoft"><strong>{telegramRouteManagerCopy()}</strong><span>Use chat IDs and numeric topic IDs, not visible topic names.</span></div>{botMissing && <div className="callout warningSoft"><strong>Bot missing</strong><span>{botMissing}</span></div>}<div className="overviewCards"><StatusMini label="Bot" value={summary.botStatus} /><StatusMini label="Delivery state" value={summary.finalPublishing} /><StatusMini label="Routes" value={String(summary.routeCount)} /><StatusMini label="Enabled outputs" value={String(summary.enabledOutputCount)} /><StatusMini label="Media mode" value={summary.mediaMode} /><StatusMini label="WordPress" value={summary.wordpress} /></div>{!compact && <FormFieldSummary />}{summary.routeCards.length === 0 && <EmptyState title={telegramRoutesEmptyStateTitle()} text={telegramRoutesEmptyStateText(summary)} />}{summary.routeCards.map((route) => <article className="panel" key={`${route.category}-${route.sourceChatId}-${route.sourceThreadId}`}><h3>{route.title}</h3><p className="muted">Source: {route.sourceChatId} / topic {route.sourceThreadId} · prompt: {route.promptProfile} · {route.enabledLabel}</p>{route.warnings.map((warning) => <p className="callout warningSoft" key={warning}>{warning}</p>)}<div className="grid two">{route.outputs.map((output) => <div className="statusCard" key={`${route.category}-${output.language}-${output.finalChatId}`}><small>{output.language} · {output.enabledLabel}</small><h3>{output.finalChatId}</h3><p>Review: {output.reviewChatId} / topic {output.reviewThreadId}</p><p>Publish: {output.publishEnabledLabel} · {output.publishMode} · {output.timezone}</p><p>Window: {output.allowedPublishWindows.length > 0 ? output.allowedPublishWindows.join(", ") : "any time"}</p><p>Gap: {output.minimumGapMinutes}m · Hour: {output.maxPostsPerHour} · Day: {output.maxPostsPerDay} · Priority: {output.queuePriority}</p><p>Status: {output.latestStatus}</p></div>)}</div></article>)}</div>;
}

function FormFieldSummary(): JSX.Element {
  return <details className="panel"><summary>Route form guide</summary><div className="grid two"><div>{TELEGRAM_ROUTE_FORM_FIELDS.map((field) => <p key={field.label}><strong>{field.label}</strong><br /><span className="muted">{field.helper}</span></p>)}</div><div>{TELEGRAM_OUTPUT_FORM_FIELDS.map((field) => <p key={field.label}><strong>{field.label}</strong><br /><span className="muted">{field.helper}</span></p>)}</div></div></details>;
}

function StatusMini({ label, value }: { label: string; value: string }): JSX.Element { return <article className="statusCard"><small>{label}</small><h3>{value}</h3></article>; }
function DiagnosticsPage(props: { enabled: boolean; busy: string | undefined; summary: JsonObject | undefined; validation: JsonObject | undefined; configExport: JsonObject | undefined; loadDiagnostics: () => void; exportConfig: () => void }): JSX.Element {
  const readiness = readObject(props.summary, "readiness") ?? readObject(props.validation, "readiness");
  const issues = readArray(props.validation, "issues");
  const secrets = readObject(props.summary, "secrets");
  const media = readObject(props.summary, "media");
  return <section className="pageStack"><PageHeader eyebrow="Diagnostics" title="Launch readiness and setup checks" text="Actionable health checks for Telegram, media processing, AI, publishing, secrets, and route configuration." action={<div className="buttonRow"><button type="button" onClick={props.loadDiagnostics} disabled={!props.enabled || props.busy !== undefined}>Run diagnostics</button><button type="button" className="secondary" onClick={props.exportConfig} disabled={!props.enabled || props.busy !== undefined}>Safe export</button></div>} />{!props.enabled && <EmptyState title="Admin access needed" text="Save admin access in Setup Wizard before running diagnostics." />}{props.enabled && <><div className="overviewCards"><StatusMini label="Readiness" value={readString(readiness, "label") ?? "unknown"} /><StatusMini label="Errors" value={String(readNumber(readiness, "errors") ?? 0)} /><StatusMini label="Warnings" value={String(readNumber(readiness, "warnings") ?? 0)} /><StatusMini label="Score" value={String(readNumber(readiness, "score") ?? 0)} /></div><div className="grid two"><article className="panel"><h3>Configured secrets</h3>{Object.entries(secrets ?? {}).map(([key, value]) => <p key={key}><strong>{key}</strong>: {value === true ? "configured" : "missing"}</p>)}</article><article className="panel"><h3>Media settings</h3><pre>{JSON.stringify(media ?? {}, null, 2)}</pre></article></div><h3>Issues</h3>{issues.length === 0 ? <EmptyState title="No issues loaded" text="Run diagnostics to load validation issues." /> : issues.map((issue, index) => <article className={`callout ${readString(issue, "severity") === "error" ? "warningSoft" : "neutralSoft"}`} key={`${readString(issue, "code") ?? index}`}><strong>{readString(issue, "area") ?? "setup"} · {readString(issue, "code") ?? "issue"}</strong><span>{readString(issue, "message") ?? "No message"}</span><small>{readString(issue, "action") ?? "Review settings."}</small></article>)}{props.configExport && <details className="panel" open><summary>Safe config export</summary><pre>{JSON.stringify(props.configExport, null, 2)}</pre></details>}</>}</section>;
}

function TestsPage(props: { internalReady: boolean; busy: string | undefined; history: OperationRecord[]; refreshStatus: () => void; validateRoutes: () => void }): JSX.Element { return <section className="pageStack"><PageHeader eyebrow="Tests" title="Safe checks" text="Run guarded checks only." /><div className="testGrid"><article className="testCard"><h3>Readiness check</h3><button type="button" onClick={props.refreshStatus} disabled={props.busy !== undefined}>Run readiness check</button></article><article className="testCard"><h3>Telegram route config</h3><button type="button" onClick={props.validateRoutes} disabled={!props.internalReady || props.busy !== undefined}>Check route config</button></article></div><RecentResults history={props.history} /></section>; }
function ActivityPage({ audit, recentTelegramOutputs, telegramQueueItems, mediaJobs, enabled, busy, loadActivity, loadRecentTelegramOutputs, loadTelegramQueue, loadMediaJobs, runDuePublish }: { audit: AdminAuditEntry[]; recentTelegramOutputs: RecentTelegramOutput[]; telegramQueueItems: TelegramQueueItem[]; mediaJobs: MediaJobItem[]; enabled: boolean; busy: string | undefined; loadActivity: () => Promise<void>; loadRecentTelegramOutputs: () => void; loadTelegramQueue: () => void; loadMediaJobs: () => void; runDuePublish: () => void }): JSX.Element { return <section className="pageStack"><PageHeader eyebrow="Activity" title="Recent outputs, queue, media jobs, and changes" text="Review generated outputs, publish queue status, media processor jobs, scheduled times, final channels, and protected settings audit." action={<div className="buttonRow"><button type="button" onClick={loadRecentTelegramOutputs} disabled={!enabled || busy !== undefined}>Load outputs</button><button type="button" className="secondary" onClick={loadTelegramQueue} disabled={!enabled || busy !== undefined}>Load queue</button><button type="button" className="secondary" onClick={loadMediaJobs} disabled={!enabled || busy !== undefined}>Load media jobs</button><button type="button" className="secondary" onClick={runDuePublish} disabled={!enabled || busy !== undefined}>Run due publish</button><button type="button" className="secondary" onClick={() => void loadActivity()} disabled={!enabled || busy !== undefined}>Load audit</button></div>} />{!enabled && <EmptyState title="Admin access needed" text="Save admin access in Setup Wizard to load activity." />}<h3>Generated Telegram outputs</h3><div className="grid two">{recentTelegramOutputs.map((output) => <article className="activityItem" key={`${output.itemId}:${output.language}:${output.updatedAt}`}><div><span className="badge neutral">{output.language}</span><h3>{output.category}</h3><p>Item: {output.itemId}</p><p>Review: {output.reviewStatus} · Queue: {output.publishQueueStatus}</p><p>Final: {output.finalChatId}</p>{output.lastError !== "none" && output.lastError.length > 0 && <p className="warningText">{output.lastError}</p>}<small>{output.updatedAt}</small></div></article>)}</div><h3>Publish queue</h3><div className="grid two">{telegramQueueItems.map((queueItem) => <article className="activityItem" key={queueItem.queueId}><div><span className="badge neutral">{queueItem.status}</span><h3>{queueItem.finalChatId}</h3><p>{queueItem.language} · {queueItem.generatedOutputId}</p><p>Scheduled: {queueItem.scheduledFor}</p><p>Priority: {queueItem.priority} · Attempts: {queueItem.attemptCount}</p>{queueItem.lastError !== "none" && queueItem.lastError.length > 0 && <p className="warningText">{queueItem.lastError}</p>}<small>{queueItem.updatedAt}</small></div></article>)}</div><h3>Media jobs</h3><div className="grid two">{mediaJobs.map((job) => <article className="activityItem" key={job.jobId}><div><span className="badge neutral">{job.status}</span><h3>{job.mediaAssetId}</h3><p>Item: {job.itemId}</p><p className="muted">{job.sourceUrl}</p>{job.errorMessage !== "none" && job.errorMessage.length > 0 && <p className="warningText">{job.errorMessage}</p>}<small>{job.updatedAt}</small></div></article>)}</div><h3>Admin audit</h3>{audit.map((entry) => <article className="activityItem" key={entry.id}><div><span className="badge neutral">{entry.action}</span><h3>{entry.key}</h3><p>{new Date(entry.changed_at).toLocaleString()}</p></div><div className="auditValues"><span>Previous: {entry.previous_value_redacted ?? "[missing]"}</span><span>New: {entry.new_value_redacted ?? "[missing]"}</span></div></article>)}</section>; }
function TechnicalPage({ bundle, adminConfig, history, clearHistory }: { bundle: StatusBundle; adminConfig: AdminConfigResponse | undefined; history: OperationRecord[]; clearHistory: () => void }): JSX.Element { return <section className="pageStack"><PageHeader eyebrow="Technical" title="Debugging details" text="Raw payloads and troubleshooting information live here only." action={<button type="button" className="secondary" onClick={clearHistory}>Clear history</button>} /><details className="panel" open><summary>Raw /status and /ready</summary><div className="grid two"><JsonPanel title="/health" result={bundle.health} /><JsonPanel title="/status" result={bundle.status} /><JsonPanel title="/ready" result={bundle.ready} /></div></details><details className="panel"><summary>Raw admin config</summary><pre>{JSON.stringify(redactSensitiveJson(unknownToJsonValue(adminConfig ?? null)), null, 2)}</pre></details><details className="panel"><summary>Raw test output</summary><RecentResults history={history} /></details></section>; }
function PageHeader({ eyebrow, title, text, action }: { eyebrow: string; title: string; text: string; action?: JSX.Element }): JSX.Element { return <div className="pageHeader"><div><p className="eyebrow">{eyebrow}</p><h2>{title}</h2><p>{text}</p></div>{action}</div>; }
function EmptyState({ title, text }: { title: string; text: string }): JSX.Element { return <div className="emptyState"><h3>{title}</h3><p>{text}</p></div>; }
function ConnectionPanel({ feedback }: { feedback: ConnectionFeedback }): JSX.Element { return <div className={`callout ${feedback.state === "connected" ? "safeSoft" : "warningSoft"}`}><strong>{feedback.title}</strong><span>{feedback.detail}</span>{feedback.guidance.map((item) => <small key={item}>{item}</small>)}</div>; }
function RecentResults({ history }: { history: OperationRecord[] }): JSX.Element { return <div>{history.map((record) => <details key={record.id}><summary>{record.label} · {record.ok ? "OK" : "Error"}</summary><pre>{JSON.stringify(record.result, null, 2)}</pre></details>)}</div>; }
function JsonPanel({ title, result }: { title: string; result: ApiResult | undefined }): JSX.Element { return <div><h3>{title}</h3><pre>{JSON.stringify(result ?? null, null, 2)}</pre></div>; }
function parseDashboardInteger(value: string, fallback: number): number { const parsed = Number.parseInt(value, 10); return Number.isFinite(parsed) ? parsed : fallback; }
function badgeTone(value: string): string { return value === "Connected" || value === "Safe" ? "safe" : value === "Optional" ? "neutral" : "warning"; }
function feedbackFromBundle(bundle: StatusBundle): ConnectionFeedback { const state = describeConnectionBundle(bundle); if (state === "connected") return { state, title: "Worker connected", detail: "Worker health, status, and readiness are reachable.", guidance: [] }; if (state === "reachable_not_ready") return { state, title: "Worker reachable, setup incomplete", detail: "The Worker responded, but readiness has warnings.", guidance: ["Open Setup Wizard.", "Check Technical for raw readiness details."] }; if (state === "cors_blocked") return { state, title: "Browser blocked the request", detail: "Likely CORS or network configuration.", guidance: connectionGuidance() }; return { state, title: "Worker unreachable", detail: "The dashboard could not reach the Worker.", guidance: connectionGuidance() }; }
function connectionGuidance(): string[] { return ["Use the deployed Worker URL, including https://.", "For local development, use http://localhost:8787.", "Check CORS settings if the Worker opens but dashboard calls fail."]; }
function resultToJson(result: ApiResult<unknown> | undefined): JsonValue { if (result === undefined) return null; if (result.ok) return unknownToJsonValue(result.data); const payload: JsonObject = { error: result.error, message: result.message }; if (typeof result.status === "number") payload.status = result.status; if (result.data !== undefined) payload.data = result.data; return payload; }
function unknownToJsonValue(value: unknown): JsonValue { if (value === undefined) return null; return JSON.parse(JSON.stringify(value)) as JsonValue; }
function isAdminGroup(value: SettingsSection): value is AdminConfigGroup { return value !== "activity" && value !== "technical"; }
function readAdminConfigValue(config: AdminConfigResponse | undefined, key: string): string | undefined { return config?.items.find((item) => item.key === key)?.value; }
function readObject(value: unknown, key: string): JsonObject | undefined { return typeof value === "object" && value !== null && !Array.isArray(value) && typeof (value as JsonObject)[key] === "object" && (value as JsonObject)[key] !== null && !Array.isArray((value as JsonObject)[key]) ? (value as JsonObject)[key] as JsonObject : undefined; }
function readArray(value: unknown, key: string): JsonObject[] { const record = typeof value === "object" && value !== null && !Array.isArray(value) ? value as JsonObject : undefined; const raw = record?.[key]; return Array.isArray(raw) ? raw.filter((entry): entry is JsonObject => typeof entry === "object" && entry !== null && !Array.isArray(entry)) : []; }
function readNumber(value: unknown, key: string): number | undefined { const record = typeof value === "object" && value !== null && !Array.isArray(value) ? value as JsonObject : undefined; const raw = record?.[key]; return typeof raw === "number" ? raw : undefined; }
function readString(value: unknown, key: string): string | undefined { const record = typeof value === "object" && value !== null && !Array.isArray(value) ? value as JsonObject : undefined; const raw = record?.[key]; return typeof raw === "string" ? raw : undefined; }
function readBoolean(value: unknown, key: string): boolean | undefined { const record = typeof value === "object" && value !== null && !Array.isArray(value) ? value as JsonObject : undefined; const raw = record?.[key]; return typeof raw === "boolean" ? raw : undefined; }
