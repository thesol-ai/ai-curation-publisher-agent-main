import { useEffect, useMemo, useRef, useState } from "react";
import { describeConnectionBundle, validateWorkerBaseUrl, WorkerApiClient } from "./api";
import { clearSettings, getInternalCredential, loadSettings, saveApiBaseUrl, saveInternalCredential } from "./storage";
import type { AdminConfigItem, AdminConfigResponse, ApiResult, DashboardSettings, JsonObject, JsonValue, StatusBundle } from "./types";
import { Alert, Badge, Button, Card, CardHeader, DataTable, Input, Progress, Select, StatCard, Switch, Textarea } from "./shared/ui";
import { BarChartCard, DonutChartCard, FunnelCard } from "./shared/charts";
import { RouteOutputBuilder } from "./features/admin-control/route-output-builder";
import { PublishQueueTable } from "./features/admin-control/publish-queue-table";
import { PromptStudioPanel } from "./features/admin-control/prompt-studio-panel";
import { SetupWizardPanel } from "./features/admin-control/setup-wizard-panel";
import { filterSettings, findSetting, groupLabel, groupedSettings, relatedSettingForIssue, removeDraft, SettingsEditor, settingValue, sourceTone, type SettingSaveState } from "./features/admin-control/settings-editor";
import { PromptDiffPanel, PromptRunsTable } from "./features/admin-control/prompt-studio-panels";
import { CategoryHealthTable, CategoryScopeSelector, CategoryWorkspace, EnvironmentBanner, MediaPipelineDiagram, RouteTimingSummary, SecretOverview, filterIssuesByScope, filterOutputsByScope, filterQueueByScope, filterRoutesByScope, type CategoryScope } from "./features/admin-control/category-topology";
import { CategoryWizardPage } from "./features/admin-control/category-wizard";

type DashboardTab = "overview" | "operations" | "categories" | "curation" | "setup" | "settings" | "ai" | "providers" | "telegram" | "routes" | "media" | "prompts" | "publishing" | "diagnostics" | "activity" | "technical";
type PromptProfileForm = { id: string; name: string; category: string; language: string; contentType: string; version: string; status: string; systemPrompt: string; userPromptTemplate: string; modelHint: string; temperature: string; maxTokens: string; riskPolicy: string; styleGuide: string; negativePrompt: string };
type PromptBindingForm = { routeId: string; routeOutputId: string; category: string; language: string; promptProfileId: string; contentType: string };
type SettingFilter = { groups?: string[]; keys?: string[]; keyIncludes?: string[]; excludeSecrets?: boolean };
type ToastTone = "success" | "warning" | "danger" | "info";
type ToastRecord = { id: string; tone: ToastTone; title: string; message: string; details?: JsonValue };
type RefreshOptions = { notify?: boolean };

const emptyPromptForm: PromptProfileForm = {
  id: "telegram_crypto_fa_v1",
  name: "Crypto FA Telegram Editorial",
  category: "crypto",
  language: "fa",
  contentType: "social_post",
  version: "1.0.0",
  status: "draft",
  systemPrompt: [
    "You are an editorial automation assistant for Telegram publishing.",
    "Write in {{language}} for the {{category}} audience.",
    "Preserve facts from the source. Do not invent claims, prices, quotes, or financial advice.",
    "Return only valid JSON matching the Telegram output schema."
  ].join("\n"),
  userPromptTemplate: [
    "Category: {{category}}",
    "Language: {{language}}",
    "Source URL: {{sourceUrl}}",
    "Original text:",
    "{{sourceText}}",
    "Links:",
    "{{links}}",
    "Channel signature:",
    "{{channelSignature}}",
    "Task: rewrite the source into a Telegram-ready caption."
  ].join("\n"),
  modelHint: "",
  temperature: "0.4",
  maxTokens: "1200",
  riskPolicy: "Do not provide financial advice or unsupported claims.",
  styleGuide: "Concise, accurate, source-faithful, and ready for human review.",
  negativePrompt: "Do not invent prices, quotes, unsupported claims, financial advice, exaggerated promises, or unrelated hashtags."
};

const emptyBindingForm: PromptBindingForm = { routeId: "", routeOutputId: "", category: "crypto", language: "fa", promptProfileId: "telegram_crypto_fa_v1", contentType: "social_post" };

const aiModelPresets = {
  openai: ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini", "gpt-4.1"],
  gemini: ["gemini-1.5-flash", "gemini-1.5-pro", "gemini-2.0-flash", "gemini-2.0-flash-lite"]
};

export default function ModernDashboardApp(): JSX.Element {
  const [settings, setSettings] = useState<DashboardSettings>(() => loadSettings());
  const [apiBaseUrlInput, setApiBaseUrlInput] = useState(settings.apiBaseUrl);
  const [credentialInput, setCredentialInput] = useState("");
  const [activeTab, setActiveTab] = useState<DashboardTab>("overview");
  const [statusBundle, setStatusBundle] = useState<StatusBundle>({});
  const [summary, setSummary] = useState<JsonObject | undefined>(undefined);
  const [metrics, setMetrics] = useState<JsonObject | undefined>(undefined);
  const [timeseries, setTimeseries] = useState<JsonObject | undefined>(undefined);
  const [validation, setValidation] = useState<JsonObject | undefined>(undefined);
  const [adminConfig, setAdminConfig] = useState<AdminConfigResponse | undefined>(undefined);
  const [routes, setRoutes] = useState<JsonObject[]>([]);
  const [outputs, setOutputs] = useState<JsonObject[]>([]);
  const [mediaJobs, setMediaJobs] = useState<JsonObject[]>([]);
  const [publishQueue, setPublishQueue] = useState<JsonObject[]>([]);
  const [promptStudio, setPromptStudio] = useState<JsonObject | undefined>(undefined);
  const [adminExport, setAdminExport] = useState<JsonObject | undefined>(undefined);
  const [configImportText, setConfigImportText] = useState("");
  const [configImportInput, setConfigImportInput] = useState("");
  const [configImportPreview, setConfigImportPreview] = useState<JsonObject | undefined>(undefined);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState<string | undefined>(undefined);
  const [busyQueueId, setBusyQueueId] = useState<string | undefined>(undefined);
  const [settingDrafts, setSettingDrafts] = useState<Record<string, string>>({});
  const [settingsSection, setSettingsSection] = useState("all");
  const [queueStatusFilter, setQueueStatusFilter] = useState("all");
  const [queueSearch, setQueueSearch] = useState("");
  const [promptForm, setPromptForm] = useState<PromptProfileForm>(emptyPromptForm);
  const [bindingForm, setBindingForm] = useState<PromptBindingForm>(emptyBindingForm);
  const [promptPreview, setPromptPreview] = useState<JsonObject | undefined>(undefined);
  const [testResult, setTestResult] = useState<JsonObject | undefined>(undefined);
  const [categoryScope, setCategoryScope] = useState<CategoryScope>("all");
  const [settingSaveStates, setSettingSaveStates] = useState<Record<string, SettingSaveState>>({});
  const [lastRefreshAt, setLastRefreshAt] = useState<string | undefined>(undefined);
  const [testDataResult, setTestDataResult] = useState<JsonObject | undefined>(undefined);
  const [mediaDebugUrl, setMediaDebugUrl] = useState("");
  const [mediaDebugResult, setMediaDebugResult] = useState<JsonObject | undefined>(undefined);
  const [busyMediaJobId, setBusyMediaJobId] = useState<string | undefined>(undefined);
  const [publishPreview, setPublishPreview] = useState<JsonObject | undefined>(undefined);
  const [duePublishResult, setDuePublishResult] = useState<JsonObject | undefined>(undefined);
  const [timelineInput, setTimelineInput] = useState("");
  const [timelineResult, setTimelineResult] = useState<JsonObject | undefined>(undefined);
  const [dedupeUrl, setDedupeUrl] = useState("");
  const [dedupeResult, setDedupeResult] = useState<JsonObject | undefined>(undefined);
  const [operationsAnalytics, setOperationsAnalytics] = useState<JsonObject | undefined>(undefined);
  const [categoryData, setCategoryData] = useState<JsonObject | undefined>(undefined);
  const [curationRuns, setCurationRuns] = useState<JsonObject[]>([]);
  const [curationDecisions, setCurationDecisions] = useState<JsonObject[]>([]);
  const [curationBusy, setCurationBusy] = useState(false);
  const [curationTriggerResult, setCurationTriggerResult] = useState<JsonObject | undefined>(undefined);
  const [operationsRangeDays, setOperationsRangeDays] = useState("30");
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  const toastTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const autoRefreshedApiBaseUrl = useRef<string | undefined>(undefined);

  const client = useMemo(() => new WorkerApiClient(settings.apiBaseUrl, getInternalCredential()), [settings]);
  const connectionState = describeConnectionBundle(statusBundle);
  const issues = readArray(validation ?? summary, "issues");
  const readiness = readObject(summary, "readiness") ?? readObject(validation, "readiness");
  const readinessScore = readNumber(readiness, "score") ?? 0;
  const metricCards = readObject(metrics, "cards") ?? {};
  const metricDistributions = readObject(metrics, "distributions") ?? {};
  const metricTimeSeries = readObject(metrics, "timeSeries") ?? {};
  const promptProfiles = readArray(promptStudio, "profiles");
  const promptBindings = readArray(promptStudio, "bindings");
  const promptRuns = readArray(promptStudio, "runs");
  const allSettings = adminConfig?.items ?? [];
  const scopedRoutes = filterRoutesByScope(routes, categoryScope);
  const scopedOutputs = filterOutputsByScope(outputs, categoryScope);
  const scopedIssues = filterIssuesByScope(issues, routes, categoryScope);
  const scopedPublishQueue = filterQueueByScope(publishQueue, categoryScope);

  function pushToast(tone: ToastTone, title: string, message: string, details?: JsonValue): void {
    const id = `toast_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    setToasts((current) => [{ id, tone, title, message, ...(details === undefined ? {} : { details }) }, ...current].slice(0, 5));
    toastTimers.current[id] = setTimeout(() => dismissToast(id), toastDurationMs(tone, details));
  }

  function dismissToast(id: string): void {
    const timer = toastTimers.current[id];
    if (timer !== undefined) clearTimeout(timer);
    delete toastTimers.current[id];
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }

  function notify(tone: ToastTone, title: string, message: string, details?: JsonValue): void {
    setNotice(`${title}: ${message}`);
    pushToast(tone, title, message, details);
  }

  useEffect(() => {
    return () => {
      for (const timer of Object.values(toastTimers.current)) clearTimeout(timer);
      toastTimers.current = {};
    };
  }, []);

  useEffect(() => {
    if (settings.apiBaseUrl.length === 0) return;
    if (autoRefreshedApiBaseUrl.current === settings.apiBaseUrl) return;
    autoRefreshedApiBaseUrl.current = settings.apiBaseUrl;
    void refreshAll(client, { notify: false });
  }, [settings.apiBaseUrl]);

  async function saveAndConnect(): Promise<void> {
    const valid = validateWorkerBaseUrl(apiBaseUrlInput);
    if (!valid.ok) { notify("danger", "Invalid Worker URL", valid.message); return; }
    saveApiBaseUrl(valid.value);
    if (credentialInput.trim().length > 0) saveInternalCredential(credentialInput.trim(), false);
    setCredentialInput("");
    const nextSettings = loadSettings();
    autoRefreshedApiBaseUrl.current = nextSettings.apiBaseUrl;
    setSettings(nextSettings);
    await refreshAll(new WorkerApiClient(nextSettings.apiBaseUrl, getInternalCredential()), { notify: true });
  }

  function clearConnection(): void {
    clearSettings();
    const nextSettings = loadSettings();
    setSettings(nextSettings);
    setApiBaseUrlInput("");
    setCredentialInput("");
    setStatusBundle({});
    setSummary(undefined);
    setMetrics(undefined);
    setTimeseries(undefined);
    setValidation(undefined);
    setAdminConfig(undefined);
    setRoutes([]);
    setOutputs([]);
    setMediaJobs([]);
    setPublishQueue([]);
    setPromptStudio(undefined);
    setCategoryData(undefined);
    notify("info", "Connection cleared", "Worker URL and Admin secret were cleared from this browser session.");
  }

  async function refreshAll(targetClient = client, options: RefreshOptions = { notify: true }): Promise<void> {
    setBusy("refresh");
    const nextStatus = await targetClient.getStatusBundle();
    setStatusBundle(nextStatus);
    const [nextConfig, nextSummary, nextValidation, nextMetrics, nextTimeseries, nextRoutes, nextJobs, nextQueue, nextPrompts, nextAnalytics, nextCategories] = await Promise.all([
      targetClient.getAdminConfig(),
      targetClient.getAdminSummary(),
      targetClient.getAdminValidation(),
      targetClient.getAdminMetricsOverview(),
      targetClient.getAdminMetricsTimeseries(30),
      targetClient.getTelegramTopicRoutes(),
      targetClient.getMediaJobs(25),
      targetClient.getTelegramPublishQueue(50),
      targetClient.getPromptStudio(),
      targetClient.getAdminAnalyticsOverview(Number(operationsRangeDays), String(categoryScope)),
      targetClient.getCategories()
    ]);
    if (nextConfig.ok) setAdminConfig(nextConfig.data);
    if (nextSummary.ok) setSummary(nextSummary.data);
    if (nextValidation.ok) setValidation(nextValidation.data);
    if (nextMetrics.ok) setMetrics(nextMetrics.data);
    if (nextTimeseries.ok) setTimeseries(nextTimeseries.data);
    if (nextRoutes.ok) {
      const routeItems = readArray(nextRoutes.data, "routes");
      setRoutes(routeItems);
      setOutputs(routeItems.flatMap((route) => readArray(route, "outputs").map((output) => ({ ...output, routeId: readString(output, "routeId") ?? readString(route, "id") ?? "unknown", category: readString(route, "category") ?? "uncategorized" }))));
    }
    if (nextJobs.ok) setMediaJobs(readArray(nextJobs.data, "jobs"));
    if (nextQueue.ok) setPublishQueue(readArray(nextQueue.data, "queue"));
    if (nextPrompts.ok) setPromptStudio(nextPrompts.data);
    if (nextAnalytics.ok) setOperationsAnalytics(nextAnalytics.data);
    if (nextCategories.ok) setCategoryData(nextCategories.data);
    const refreshMessage = connectionNotice(nextStatus, nextSummary, nextValidation);
    setNotice(refreshMessage);
    if (options.notify !== false) notify(nextSummary.ok && nextValidation.ok ? "success" : "warning", "Dashboard refreshed", refreshMessage);
    setLastRefreshAt(new Date().toISOString());
    setBusy(undefined);
  }

  async function refreshConfigSideEffects(): Promise<void> {
    const [nextStatus, nextSummary, nextValidation] = await Promise.all([
      client.getStatusBundle(),
      client.getAdminSummary(),
      client.getAdminValidation()
    ]);

    setStatusBundle(nextStatus);
    if (nextSummary.ok) setSummary(nextSummary.data);
    if (nextValidation.ok) setValidation(nextValidation.data);
    setLastRefreshAt(new Date().toISOString());
  }

  async function refreshOperationsAnalytics(): Promise<void> {
    setBusy("operations-analytics");
    const response = await client.getAdminAnalyticsOverview(Number(operationsRangeDays), String(categoryScope));
    if (response.ok) {
      setOperationsAnalytics(response.data);
      notify("success", "Operations refreshed", `Loaded ${operationsRangeDays} day analytics for ${String(categoryScope)}.`);
    } else {
      notify("danger", "Operations analytics failed", response.message, response.data);
    }
    setBusy(undefined);
  }

  async function saveSetting(item: AdminConfigItem): Promise<void> {
    const value = settingValue(item, settingDrafts);
    if (item.isSecret === true && value.trim().length === 0) {
      notify("warning", "Secret value required", `Enter a new value before saving ${item.key}. Existing secret values are never displayed.`);
      return;
    }

    setBusy(`save-${item.key}`);
    setSettingSaveStates((states) => ({ ...states, [item.key]: "saving" }));
    try {
      const response = await client.saveAdminConfig([{ key: item.key, value }]);
      if (response.ok) {
        setAdminConfig(response.data);
        const savedItem = response.data.items.find((entry) => entry.key === item.key);
        const effective = savedItem?.isSecret === true ? "[secret]" : savedItem?.value ?? "";
        const savedAndEffective = savedItem?.isSecret === true || effective === value || savedItem?.source === "d1";
        setSettingSaveStates((states) => ({ ...states, [item.key]: savedAndEffective ? "saved" : "saved_but_not_effective" }));
        notify(savedAndEffective ? "success" : "warning", savedAndEffective ? "Saved" : "Saved but not effective", savedAndEffective ? `Saved ${item.key}. Effective source: ${savedItem?.source ?? "unknown"}.` : `Saved ${item.key}, but effective value still appears to come from ${savedItem?.source ?? "another source"}.`);
        setSettingDrafts((drafts) => removeDraft(drafts, item.key));
        await refreshConfigSideEffects();
      } else {
        setSettingSaveStates((states) => ({ ...states, [item.key]: "failed" }));
        notify("danger", "Request failed", response.message, response.data);
      }
    } catch (error) {
      setSettingSaveStates((states) => ({ ...states, [item.key]: "failed" }));
      notify("danger", "Save failed", error instanceof Error ? error.message : `Failed to save ${item.key}.`);
    } finally {
      setBusy(undefined);
    }
  }

  async function resetSetting(item: AdminConfigItem): Promise<void> {
    setBusy(`reset-${item.key}`);
    setSettingSaveStates((states) => ({ ...states, [item.key]: "saving" }));
    try {
      const response = await client.resetAdminConfig([item.key]);
      notify(response.ok ? "success" : "danger", response.ok ? "Setting reset" : "Reset failed", response.ok ? `Reset ${item.key} to environment/default.` : response.message, response.ok ? undefined : response.data);
      if (response.ok) {
        setAdminConfig(response.data);
        setSettingDrafts((drafts) => removeDraft(drafts, item.key));
        setSettingSaveStates((states) => ({ ...states, [item.key]: "clean" }));
        await refreshConfigSideEffects();
      } else {
        setSettingSaveStates((states) => ({ ...states, [item.key]: "failed" }));
      }
    } catch (error) {
      setSettingSaveStates((states) => ({ ...states, [item.key]: "failed" }));
      notify("danger", "Reset failed", error instanceof Error ? error.message : `Failed to reset ${item.key}.`);
    } finally {
      setBusy(undefined);
    }
  }

  async function previewQueueItem(queueId: string): Promise<void> {
    setBusyQueueId(queueId);
    const response = await client.previewTelegramPublish(queueId);
    setPublishPreview(response.ok ? readObject(response.data, "preview") ?? response.data : { ok: false, error: response.error, message: response.message, ...(response.data === undefined ? {} : { data: response.data }) });
    notify(response.ok ? "success" : "danger", response.ok ? "Publish preview loaded" : "Preview failed", response.ok ? `Preview loaded for ${queueId}.` : response.message, response.ok ? undefined : response.data);
    setBusyQueueId(undefined);
  }

  async function publishQueueItemNow(queueId: string): Promise<void> {
    setBusyQueueId(queueId);
    const previewResponse = await client.previewTelegramPublish(queueId);
    const preview = previewResponse.ok ? readObject(previewResponse.data, "preview") ?? previewResponse.data : undefined;
    if (preview !== undefined) setPublishPreview(preview);
    const blockers = readArrayOfStrings(preview, "blockers");
    const warnings = readArrayOfStrings(preview, "warnings");
    const media = readObject(preview, "media");
    const confirmText = [
      `Publish queue item ${queueId} now?`,
      `Final: ${readString(preview, "finalChatId") ?? "unknown"}`,
      `Output: ${readString(preview, "routeOutputId") ?? "unknown"}`,
      `Media: ${readString(media, "status") ?? "unknown"} (${readNumber(media, "readyAssetCount") ?? 0}/${readNumber(media, "assetCount") ?? 0} ready)`,
      blockers.length > 0 ? `Blockers: ${blockers.join("; ")}` : undefined,
      warnings.length > 0 ? `Warnings: ${warnings.join("; ")}` : undefined,
      "This sends to the final Telegram channel."
    ].filter((entry): entry is string => entry !== undefined).join("\n");
    const confirmed = globalThis.confirm?.(confirmText) ?? true;
    if (!confirmed) { setBusyQueueId(undefined); return; }
    notify("info", "Publishing", `Publishing ${queueId} now...`);
    const response = await client.publishTelegramNow(queueId);
    setPublishPreview(response.ok ? readObject(response.data, "preview") ?? response.data : { ok: false, error: response.error, message: response.message, ...(response.data === undefined ? {} : { data: response.data }) });
    notify(response.ok ? "success" : "danger", response.ok ? "Publish completed" : "Publish failed", response.ok ? `Publish now completed for ${queueId}.` : response.message, response.ok ? response.data : response.data);
    if (response.ok) await refreshAll();
    setBusyQueueId(undefined);
  }

  async function bulkPublishQueueNow(queueIds: string[]): Promise<void> {
    if (queueIds.length === 0) return;
    const confirmed = globalThis.confirm?.(`Publish ${queueIds.length} selected queue item(s) now? This sends to final Telegram channels.`) ?? true;
    if (!confirmed) return;
    setBusyQueueId("bulk");
    setNotice(`Publishing ${queueIds.length} selected item(s)...`);
    const response = await client.bulkPublishTelegramNow(queueIds);
    setNotice(response.ok ? `Bulk publish completed for ${queueIds.length} selected item(s).` : response.message);
    if (response.ok) await refreshAll();
    setBusyQueueId(undefined);
  }

  async function runDuePublishing(): Promise<void> {
    setBusy("publish-due");
    const response = await client.runTelegramPublishDue(5);
    setDuePublishResult(response.ok ? response.data : { ok: false, error: response.error, message: response.message, ...(response.data === undefined ? {} : { data: response.data }) });
    notify(response.ok ? "success" : "danger", response.ok ? "Due publishing completed" : "Due publishing failed", response.ok ? `Checked ${readNumber(response.data, "checkedCount") ?? readNumber(response.data, "dueCount") ?? 0}; published ${readNumber(response.data, "publishedCount") ?? 0}, skipped ${readNumber(response.data, "skippedCount") ?? 0}, failed ${readNumber(response.data, "failedCount") ?? 0}.` : response.message, response.data);
    await refreshAll();
    setBusy(undefined);
  }

  async function bulkPublishQueueItems(queueIds: string[]): Promise<void> {
    if (queueIds.length === 0) return;
    const confirmed = globalThis.confirm?.(`Publish ${queueIds.length} selected queue item(s) now?`) ?? true;
    if (!confirmed) return;
    setBusy("bulk-publish");
    const response = await client.bulkPublishTelegramNow(queueIds);
    setNotice(response.ok ? `Bulk publish completed for ${queueIds.length} item(s).` : response.message);
    await refreshAll();
    setBusy(undefined);
  }

  async function cancelQueueItem(queueId: string): Promise<void> {
    const confirmed = globalThis.confirm?.(`Cancel queue item ${queueId}?`) ?? true;
    if (!confirmed) return;
    setBusyQueueId(queueId);
    const response = await client.cancelTelegramPublishQueueItem(queueId);
    setNotice(response.ok ? `Cancelled ${queueId}.` : response.message);
    await refreshAll();
    setBusyQueueId(undefined);
  }

  async function rescheduleQueueItem(queueId: string): Promise<void> {
    const defaultDate = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const scheduledFor = globalThis.prompt?.("New scheduled time as ISO timestamp", defaultDate) ?? "";
    if (!scheduledFor.trim()) return;
    setBusyQueueId(queueId);
    const response = await client.rescheduleTelegramPublishQueueItem(queueId, scheduledFor.trim());
    setNotice(response.ok ? `Rescheduled ${queueId}.` : response.message);
    await refreshAll();
    setBusyQueueId(undefined);
  }

  async function saveRoute(route: JsonObject, existing: boolean): Promise<void> {
    setBusy("save-route");
    const routeId = readString(route, "id") ?? "";
    const response = existing ? await client.updateTelegramRoute(routeId, route) : await client.saveTelegramRoute(route);
    setNotice(response.ok ? `${existing ? "Updated" : "Created"} route ${routeId}.` : response.message);
    if (response.ok) await refreshAll();
    setBusy(undefined);
  }

  async function disableRoute(routeId: string): Promise<void> {
    if (!routeId) return;
    const confirmed = globalThis.confirm?.(`Disable route ${routeId}?`) ?? true;
    if (!confirmed) return;
    setBusy("disable-route");
    const response = await client.disableTelegramRoute(routeId);
    setNotice(response.ok ? `Disabled route ${routeId}.` : response.message);
    if (response.ok) await refreshAll();
    setBusy(undefined);
  }

  async function saveOutput(routeId: string, output: JsonObject, existing: boolean): Promise<void> {
    setBusy("save-output");
    const outputId = readString(output, "id") ?? "";
    const response = existing ? await client.updateTelegramRouteOutput(outputId, output) : await client.saveTelegramRouteOutput(routeId, output);
    setNotice(response.ok ? `${existing ? "Updated" : "Created"} output ${outputId}.` : response.message);
    if (response.ok) await refreshAll();
    setBusy(undefined);
  }

  async function disableOutput(outputId: string): Promise<void> {
    if (!outputId) return;
    const confirmed = globalThis.confirm?.(`Disable output ${outputId}?`) ?? true;
    if (!confirmed) return;
    setBusy("disable-output");
    const response = await client.disableTelegramRouteOutput(outputId);
    setNotice(response.ok ? `Disabled output ${outputId}.` : response.message);
    if (response.ok) await refreshAll();
    setBusy(undefined);
  }

  async function runAdminTest(kind: "ai" | "provider" | "telegram", input: JsonObject): Promise<void> {
    setBusy(`test-${kind}`);
    const response = kind === "ai" ? await client.testAI(input) : kind === "provider" ? await client.testProvider(input) : await client.testTelegram(input);
    setTestResult(response.ok ? response.data : { ok: false, error: response.error, message: response.message, ...(response.data === undefined ? {} : { data: response.data }) });
    setNotice(response.ok ? `${kind} test completed.` : response.message);
    setBusy(undefined);
  }

  function previewConfigImport(): void {
    try {
      const parsed = JSON.parse(configImportInput) as unknown;
      const root = readObject(parsed);
      if (!root) { setConfigImportPreview({ ok: false, message: "Import payload must be a JSON object." }); return; }
      setConfigImportPreview({
        ok: true,
        version: root.version ?? "unknown",
        routes: readArray(root, "routes").length,
        outputs: readArray(root, "routes").reduce((total, route) => total + readArray(route, "outputs").length, 0),
        hasMediaSettings: readObject(root, "mediaSettings") !== undefined,
        hasAiSettings: readObject(root, "aiSettings") !== undefined,
        hasPublishing: readObject(root, "publishing") !== undefined,
        note: "Preview only. This UI does not apply imports yet; use it to review handoff files safely before manual apply."
      });
    } catch (error) {
      setConfigImportPreview({ ok: false, message: error instanceof Error ? error.message : "Invalid JSON." });
    }
  }

  async function importSafeConfig(): Promise<void> {
    let parsed: unknown;
    try { parsed = JSON.parse(configImportText); }
    catch { setNotice("Config import JSON is invalid."); return; }
    const updates = readArray(parsed, "updates");
    if (updates.length === 0) { setNotice("Config import expects { updates: [{ key, value }] }."); return; }
    const editableByKey = new Map((adminConfig?.items ?? []).map((item) => [item.key, item]));
    const safeUpdates = updates.flatMap((entry): Array<{ key: string; value: string }> => {
      const key = readString(entry, "key");
      const value = readString(entry, "value");
      const item = key ? editableByKey.get(key) : undefined;
      if (!key || value === undefined || item === undefined || item.isSecret === true) return [];
      return [{ key, value }];
    });
    if (safeUpdates.length === 0) { setNotice("No non-secret editable settings were found in the import payload."); return; }
    setBusy("import-config");
    const response = await client.saveAdminConfig(safeUpdates);
    setNotice(response.ok ? `Imported ${safeUpdates.length} non-secret setting(s).` : response.message);
    if (response.ok) { setConfigImportText(""); await refreshAll(); }
    setBusy(undefined);
  }

  async function loadExport(): Promise<void> {
    setBusy("export");
    const response = await client.exportAdminConfig();
    if (response.ok) { setAdminExport(response.data); setNotice("Safe config export loaded. Secret values are excluded."); }
    else notify("danger", "Request failed", response.message, response.data);
    setBusy(undefined);
  }


  async function refreshTestDataCounts(): Promise<void> {
    setBusy("test-data-counts");
    const response = await client.getTestDataCounts();
    setTestDataResult(response.ok ? response.data : { ok: false, error: response.error, message: response.message });
    setNotice(response.ok ? "Staging test data counts loaded." : response.message);
    setBusy(undefined);
  }

  async function resetTestData(scope: string, confirm: string, sourceUrl?: string): Promise<void> {
    setBusy("test-data-reset");
    const payload: JsonObject = { scope, confirm };
    if (sourceUrl !== undefined && sourceUrl.trim().length > 0) payload.sourceUrl = sourceUrl.trim();
    const response = await client.resetTestData(payload);
    setTestDataResult(response.ok ? response.data : { ok: false, error: response.error, message: response.message, ...(response.data === undefined ? {} : { data: response.data }) });
    setNotice(response.ok ? `Reset ${scope} completed.` : response.message);
    if (response.ok) await refreshAll();
    setBusy(undefined);
  }

  async function debugMediaUrl(): Promise<void> {
    if (mediaDebugUrl.trim().length === 0) { setNotice("Enter a media source URL first."); return; }
    setBusy("media-debug");
    const response = await client.debugMediaUrl(mediaDebugUrl.trim());
    setMediaDebugResult(response.ok ? response.data : { ok: false, error: response.error, message: response.message, ...(response.data === undefined ? {} : { data: response.data }) });
    setNotice(response.ok ? "Media URL debug completed." : response.message);
    setBusy(undefined);
  }

  async function refreshMediaJobs(): Promise<void> {
    const response = await client.getMediaJobs(25);
    if (response.ok) setMediaJobs(readArray(response.data, "jobs"));
  }

  async function retryMediaJob(jobId: string): Promise<void> {
    if (!jobId) return;
    setBusyMediaJobId(jobId);
    const response = await client.retryMediaJob(jobId);
    notify(response.ok ? "success" : "danger", response.ok ? "Media job retried" : "Media retry failed", response.ok ? `Media job ${jobId} dispatched.` : response.message, response.data);
    if (response.ok) await refreshMediaJobs();
    setBusyMediaJobId(undefined);
  }

  async function cancelMediaJob(jobId: string): Promise<void> {
    if (!jobId) return;
    const confirmed = globalThis.confirm?.(`Cancel media job ${jobId}? This marks the local job as skipped. A remote GitHub run may still finish.`) ?? true;
    if (!confirmed) return;
    setBusyMediaJobId(jobId);
    const response = await client.cancelMediaJob(jobId);
    notify(response.ok ? "success" : "danger", response.ok ? "Media job cancelled" : "Media cancel failed", response.ok ? `Media job ${jobId} cancelled locally.` : response.message, response.data);
    if (response.ok) await refreshMediaJobs();
    setBusyMediaJobId(undefined);
  }


  async function loadItemTimeline(input: { itemId?: string; queueId?: string; generatedOutputId?: string; sourceUrl?: string }): Promise<void> {
    const target = input.itemId ?? input.queueId ?? input.generatedOutputId ?? input.sourceUrl ?? timelineInput.trim();
    if (!target) { setNotice("Enter an item, queue, generated output, or source URL first."); return; }
    setBusy("timeline");
    const response = await client.getItemTimeline({ ...input, ...(Object.keys(input).length === 0 ? guessTimelineTarget(target) : {}) });
    setTimelineResult(response.ok ? response.data : { ok: false, error: response.error, message: response.message, ...(response.data === undefined ? {} : { data: response.data }) });
    setNotice(response.ok ? "Timeline loaded." : response.message);
    setBusy(undefined);
  }

  async function searchDedupeHistory(): Promise<void> {
    if (dedupeUrl.trim().length === 0) { setNotice("Enter a source URL for dedupe search."); return; }
    setBusy("dedupe-search");
    const response = await client.searchDedupeHistory(dedupeUrl.trim());
    setDedupeResult(response.ok ? response.data : { ok: false, error: response.error, message: response.message, ...(response.data === undefined ? {} : { data: response.data }) });
    notify(response.ok ? "success" : "danger", response.ok ? "Dedupe history loaded" : "Dedupe search failed", response.ok ? "Dedupe history loaded." : response.message, response.data);
    setBusy(undefined);
  }

  async function savePromptProfile(): Promise<void> {
    setBusy("save-prompt");
    const payload: JsonObject = {
      id: promptForm.id,
      name: promptForm.name,
      category: promptForm.category,
      language: promptForm.language,
      contentType: promptForm.contentType,
      version: promptForm.version,
      status: promptForm.status,
      systemPrompt: promptForm.systemPrompt,
      userPromptTemplate: promptForm.userPromptTemplate,
      modelHint: promptForm.modelHint,
      temperature: Number(promptForm.temperature),
      maxTokens: Number(promptForm.maxTokens),
      riskPolicy: promptForm.riskPolicy,
      styleGuide: promptForm.styleGuide,
      negativePrompt: promptForm.negativePrompt
    };
    const response = await client.savePromptProfile(payload);
    setNotice(response.ok ? "Prompt profile saved." : response.message);
    if (response.ok) await reloadPrompts();
    setBusy(undefined);
  }

  async function activatePrompt(profileId: string): Promise<void> {
    setBusy("activate-prompt");
    const response = await client.activatePromptProfile(profileId);
    setNotice(response.ok ? "Prompt activated." : response.message);
    if (response.ok) await reloadPrompts();
    setBusy(undefined);
  }

  async function archivePrompt(profileId: string): Promise<void> {
    const confirmed = globalThis.confirm?.(`Archive prompt ${profileId}?`) ?? true;
    if (!confirmed) return;
    setBusy("archive-prompt");
    const response = await client.archivePromptProfile(profileId);
    setNotice(response.ok ? "Prompt archived." : response.message);
    if (response.ok) await reloadPrompts();
    setBusy(undefined);
  }

  async function savePromptBinding(): Promise<void> {
    setBusy("bind-prompt");
    const payload: JsonObject = {
      routeId: bindingForm.routeId,
      routeOutputId: bindingForm.routeOutputId,
      category: bindingForm.category,
      language: bindingForm.language,
      contentType: bindingForm.contentType,
      promptProfileId: bindingForm.promptProfileId,
      enabled: true
    };
    const response = await client.savePromptBinding(payload);
    setNotice(response.ok ? "Prompt binding saved." : response.message);
    if (response.ok) await reloadPrompts();
    setBusy(undefined);
  }

  async function previewPrompt(): Promise<void> {
    setBusy("preview-prompt");
    const response = await client.previewPrompt({ systemPrompt: promptForm.systemPrompt, userPromptTemplate: promptForm.userPromptTemplate, promptProfileId: promptForm.id, promptVersion: promptForm.version, model: promptForm.modelHint });
    if (response.ok) { setPromptPreview(readObject(response.data, "preview")); setNotice("Prompt preview rendered."); }
    else notify("danger", "Request failed", response.message, response.data);
    setBusy(undefined);
  }

  async function reloadPrompts(): Promise<void> {
    const response = await client.getPromptStudio();
    if (response.ok) setPromptStudio(response.data);
  }

  async function reloadCategories(): Promise<void> {
    const response = await client.getCategories();
    if (response.ok) setCategoryData(response.data);
  }

  async function createCategoryFromWizard(input: JsonObject): Promise<void> {
    setBusy("create-category");
    const response = await client.createCategory(input);
    notify(response.ok ? "success" : "danger", response.ok ? "Category created" : "Category creation failed", response.ok ? "Route, outputs, prompts and bindings were created." : response.message, response.ok ? response.data : response.data);
    if (response.ok) { await Promise.all([refreshAll(), reloadCategories(), reloadPrompts()]); }
    setBusy(undefined);
  }

  async function addCategoryLanguage(category: string, input: JsonObject): Promise<void> {
    setBusy("add-language");
    const response = await client.addCategoryLanguage(category, input);
    notify(response.ok ? "success" : "danger", response.ok ? "Language output created" : "Language creation failed", response.ok ? `Added language output for ${category}.` : response.message, response.ok ? response.data : response.data);
    if (response.ok) { await Promise.all([refreshAll(), reloadCategories(), reloadPrompts()]); }
    setBusy(undefined);
  }

  async function upsertSimplePrompt(input: JsonObject): Promise<void> {
    setBusy("simple-prompt");
    const response = await client.upsertPromptMap(input);
    notify(response.ok ? "success" : "danger", response.ok ? "Prompt saved and connected" : "Prompt save failed", response.ok ? "Prompt profile and binding were updated automatically." : response.message, response.ok ? response.data : response.data);
    if (response.ok) { await reloadPrompts(); await reloadCategories(); }
    setBusy(undefined);
  }

  return <>
  <main className="modern-shell">
    <aside className="modern-sidebar">
      <div className="brand-mark">AI</div>
      <div><p className="ui-eyebrow">Curation Control</p><h1>Publisher Ops</h1><p>Category-aware control center for routes, prompts, media and publishing.</p></div>
      <nav>{tabs.map((tab) => <button key={tab.id} type="button" className={activeTab === tab.id ? "active" : ""} onClick={() => setActiveTab(tab.id)}><span>{tab.icon}</span>{tab.label}</button>)}</nav>
      <div className="sidebar-status"><Badge tone={connectionState === "connected" ? "success" : connectionState === "unreachable" || connectionState === "cors_blocked" ? "danger" : "warning"}>{connectionState}</Badge><small>{settings.apiBaseUrl || "No Worker URL saved"}</small>{settings.hasInternalCredential && <Badge tone="success">admin secret in session</Badge>}{lastRefreshAt && <small>Last refresh: {new Date(lastRefreshAt).toLocaleTimeString()}</small>}</div>
    </aside>
    <section className="modern-main">
      <header className="modern-topbar"><div><p className="ui-eyebrow">{activeTab}</p><h2>{activeTabLabel(activeTab)}</h2><p>{notice ?? "Connect to a Worker, review readiness, and manage operations safely."}</p></div><div className="connect-panel"><Input label="Worker URL" value={apiBaseUrlInput} onChange={setApiBaseUrlInput} placeholder="https://worker.example.workers.dev" /><Input label="Admin secret" value={credentialInput} onChange={setCredentialInput} type="password" placeholder="Paste only locally" /><Button onClick={() => void saveAndConnect()} disabled={busy !== undefined}>Save & Connect</Button><Button variant="secondary" onClick={() => void refreshAll()} disabled={busy !== undefined}>Refresh all</Button><Button variant="ghost" onClick={clearConnection} disabled={busy !== undefined}>Clear connection</Button></div></header>
      <EnvironmentBanner summary={summary} apiBaseUrl={settings.apiBaseUrl} />
      <CategoryScopeSelector routes={routes} scope={categoryScope} onChange={setCategoryScope} />
      {connectionGuidance(connectionState, settings.apiBaseUrl, summary, validation)}
      {activeTab === "overview" && <OverviewPage readinessScore={readinessScore} metricCards={metricCards} distributions={metricDistributions} timeseries={metricTimeSeries} routes={scopedRoutes} allRoutes={routes} outputs={scopedOutputs} bindings={promptBindings} issues={scopedIssues} />}
      {activeTab === "operations" && <OperationsOverviewPage analytics={operationsAnalytics} rangeDays={operationsRangeDays} setRangeDays={setOperationsRangeDays} categoryScope={String(categoryScope)} onRefresh={refreshOperationsAnalytics} busy={busy} />}
      {activeTab === "categories" && <CategoryWizardPage routes={routes} outputs={outputs} profiles={promptProfiles} bindings={promptBindings} categoryData={categoryData} busy={busy} onCreateCategory={createCategoryFromWizard} onAddLanguage={addCategoryLanguage} onUpsertPrompt={upsertSimplePrompt} />}
      {activeTab === "curation" && <CurationPage client={client} runs={curationRuns} setRuns={setCurationRuns} decisions={curationDecisions} setDecisions={setCurationDecisions} busy={curationBusy} setBusy={setCurationBusy} triggerResult={curationTriggerResult} setTriggerResult={setCurationTriggerResult} toast={pushToast} />}
      {activeTab === "setup" && <SetupWizardPanel summary={summary} validation={validation} adminConfig={adminConfig} routes={routes} outputs={outputs} onOpenTab={(tab) => setActiveTab(tab as DashboardTab)} onTest={(input) => runAdminTest(input.provider ? "ai" : input.kind ? "telegram" : "provider", input)} testResult={testResult} busy={busy} />}
      {activeTab === "settings" && <SettingsCenterPage adminConfig={adminConfig} allSettings={allSettings} drafts={settingDrafts} setDrafts={setSettingDrafts} activeSection={settingsSection} setActiveSection={setSettingsSection} onSave={saveSetting} onReset={resetSetting} busy={busy} saveStates={settingSaveStates} />}
      {activeTab === "ai" && <AISettingsPage adminConfig={adminConfig} items={filterSettings(allSettings, { groups: ["ai"] })} drafts={settingDrafts} setDrafts={setSettingDrafts} onSave={saveSetting} onReset={resetSetting} busy={busy} saveStates={settingSaveStates} onTest={(input) => runAdminTest("ai", input)} testResult={testResult} />}
      {activeTab === "providers" && <ProvidersPage summary={summary} items={filterSettings(allSettings, { groups: ["providers", "content_input", "quotas"], keyIncludes: ["PROVIDER", "FIRECRAWL", "APIFY", "GETXAPI", "EXTERNAL_LINK", "MAX_PROVIDER"] })} drafts={settingDrafts} setDrafts={setSettingDrafts} onSave={saveSetting} onReset={resetSetting} busy={busy} saveStates={settingSaveStates} onTest={(provider) => runAdminTest("provider", { provider })} testResult={testResult} />}
      {activeTab === "telegram" && <TelegramSettingsPage summary={summary} items={filterSettings(allSettings, { groups: ["telegram"], keyIncludes: ["TELEGRAM"] })} routes={routes} outputs={outputs} drafts={settingDrafts} setDrafts={setSettingDrafts} onSave={saveSetting} onReset={resetSetting} busy={busy} saveStates={settingSaveStates} onTest={(input) => runAdminTest("telegram", input)} testResult={testResult} />}
      {activeTab === "routes" && <RoutesPage routes={scopedRoutes} outputs={scopedOutputs} promptProfiles={promptProfiles} bindings={promptBindings} issues={scopedIssues} categoryScope={categoryScope} busy={busy} onSaveRoute={saveRoute} onDisableRoute={disableRoute} onSaveOutput={saveOutput} onDisableOutput={disableOutput} />}
      {activeTab === "media" && <MediaPage summary={summary} mediaJobs={mediaJobs} items={filterSettings(allSettings, { keyIncludes: ["MEDIA", "GITHUB_MEDIA", "TELEGRAM_MEDIA", "YTDLP"] })} drafts={settingDrafts} setDrafts={setSettingDrafts} onSave={saveSetting} onReset={resetSetting} busy={busy} saveStates={settingSaveStates} mediaDebugUrl={mediaDebugUrl} setMediaDebugUrl={setMediaDebugUrl} mediaDebugResult={mediaDebugResult} onDebugMedia={debugMediaUrl} onRetryJob={retryMediaJob} onCancelJob={cancelMediaJob} busyMediaJobId={busyMediaJobId} />}
      {activeTab === "prompts" && <PromptStudioPanel profiles={promptProfiles} bindings={promptBindings} runs={promptRuns} routes={scopedRoutes} outputs={scopedOutputs} promptStudio={promptStudio} promptForm={promptForm} setPromptForm={setPromptForm} bindingForm={bindingForm} setBindingForm={setBindingForm} promptPreview={promptPreview} onSavePrompt={savePromptProfile} onActivatePrompt={activatePrompt} onArchivePrompt={archivePrompt} onSaveBinding={savePromptBinding} onPreviewPrompt={previewPrompt} onUpsertSimplePrompt={upsertSimplePrompt} busy={busy} />}
      {activeTab === "publishing" && <PublishingPage summary={summary} publishQueue={scopedPublishQueue} outputs={scopedOutputs} items={filterSettings(allSettings, { groups: ["telegram", "scheduler", "quotas"], keyIncludes: ["PUBLISH", "SCHEDULER", "MAX_PUBLISH", "TELEGRAM_PUBLISH", "TELEGRAM_FINAL_PUBLISH", "TELEGRAM_BOT_TOKEN"] })} drafts={settingDrafts} setDrafts={setSettingDrafts} onSave={saveSetting} onReset={resetSetting} busy={busy} saveStates={settingSaveStates} onPublishNow={publishQueueItemNow} onPreview={previewQueueItem} onTimeline={loadItemTimeline} onCancel={cancelQueueItem} onReschedule={rescheduleQueueItem} onRunDue={runDuePublishing} onBulkPublishNow={bulkPublishQueueItems} publishPreview={publishPreview} duePublishResult={duePublishResult} busyQueueId={busyQueueId} queueStatusFilter={queueStatusFilter} setQueueStatusFilter={setQueueStatusFilter} queueSearch={queueSearch} setQueueSearch={setQueueSearch} onEditRoutes={() => setActiveTab("routes")} />}
      {activeTab === "diagnostics" && <DiagnosticsPage issues={scopedIssues} validation={validation} summary={summary} routes={scopedRoutes} onExport={loadExport} adminExport={adminExport} importInput={configImportInput} setImportInput={setConfigImportInput} onPreviewImport={previewConfigImport} importPreview={configImportPreview} testDataResult={testDataResult} onRefreshTestData={refreshTestDataCounts} onResetTestData={resetTestData} dedupeUrl={dedupeUrl} setDedupeUrl={setDedupeUrl} dedupeResult={dedupeResult} onSearchDedupe={searchDedupeHistory} busy={busy} />}
      {activeTab === "activity" && <ActivityPage mediaJobs={mediaJobs} publishQueue={scopedPublishQueue} onPublishNow={publishQueueItemNow} onPreview={previewQueueItem} onTimeline={loadItemTimeline} onCancel={cancelQueueItem} onReschedule={rescheduleQueueItem} onBulkPublishNow={bulkPublishQueueItems} busyQueueId={busyQueueId} timelineInput={timelineInput} setTimelineInput={setTimelineInput} timelineResult={timelineResult} />}
      {activeTab === "technical" && <TechnicalPage statusBundle={statusBundle} summary={summary} metrics={metrics} timeseries={metricTimeSeries} adminConfig={adminConfig} promptStudio={promptStudio} />}
    </section>
  </main>
  <ToastStack toasts={toasts} onDismiss={dismissToast} />
  </>;
}


function OperationsOverviewPage({ analytics, rangeDays, setRangeDays, categoryScope, onRefresh, busy }: { analytics: JsonObject | undefined; rangeDays: string; setRangeDays: (value: string) => void; categoryScope: string; onRefresh: () => Promise<void>; busy: string | undefined }): JSX.Element {
  const kpis = readObject(analytics, "kpis") ?? {};
  const mediaPerformance = readObject(analytics, "mediaPerformance") ?? {};
  const promptPerformance = readObject(analytics, "promptPerformance") ?? {};
  const queueHealth = readObject(analytics, "queueHealth") ?? {};
  const funnel = readArray(analytics, "funnel").map((row) => ({ label: readString(row, "stage") ?? "stage", value: readNumber(row, "count") ?? 0 }));
  const categoryPerformance = readArray(analytics, "categoryPerformance");
  const providerHealth = readArray(analytics, "providerHealth");
  const topBlockers = readArray(analytics, "topBlockers");
  return <div className="page-grid">
    <Card className="hero-card"><CardHeader eyebrow="Operations Overview" title="Executive dashboard for throughput, quality and blockers" description="Manager-friendly KPIs, funnel health, category performance, media timings, prompt quality and provider reliability." action={<Button variant="secondary" onClick={() => void onRefresh()} disabled={busy !== undefined}>Refresh analytics</Button>} /><div className="grid two"><Select label="Date range" value={rangeDays} onChange={setRangeDays} options={["1", "7", "14", "30", "60", "90"].map((value) => ({ value, label: `${value} days` }))} /><Input label="Scope" value={categoryScope} onChange={() => undefined} /></div>{!analytics && <Alert title="Load analytics" tone="info">Click Refresh analytics to load the operations dashboard for the selected category scope.</Alert>}</Card>
    <div className="stats-grid"><StatCard label="Ingested" value={readNumber(kpis, "ingested") ?? 0} tone="info" /><StatCard label="Generated" value={readNumber(kpis, "generated") ?? 0} tone="info" /><StatCard label="Reviews sent" value={readNumber(kpis, "reviewsSent") ?? 0} tone="success" /><StatCard label="Queued" value={readNumber(kpis, "queued") ?? 0} tone="warning" /><StatCard label="Published" value={readNumber(kpis, "published") ?? 0} tone="success" /><StatCard label="Media failure rate" value={`${Math.round((readNumber(kpis, "mediaFailureRate") ?? 0) * 100)}%`} tone={(readNumber(kpis, "mediaFailureRate") ?? 0) > 0 ? "warning" : "success"} /><StatCard label="Prompt errors" value={readNumber(kpis, "promptFailures") ?? 0} tone={(readNumber(kpis, "promptFailures") ?? 0) > 0 ? "warning" : "success"} /><StatCard label="Avg media total" value={formatMs(readNumber(kpis, "averageMediaTotalMs") ?? 0)} tone="info" /></div>
    <div className="chart-grid"><FunnelCard title="Publishing funnel" description="Content flow from ingest to final publish." steps={funnel.length > 0 ? funnel : [{ label: "No data", value: 0 }]} /><DonutChartCard title="Queue health" description="Current queue status distribution in the selected period." data={readDistributionObject(queueHealth)} /><BarChartCard title="Provider attempts" description="Free/direct/social extractor attempts by provider." data={Object.fromEntries(providerHealth.map((row) => [readString(row, "provider") ?? "unknown", readNumber(row, "attempts") ?? 0]))} /></div>
    <Card><CardHeader title="Media performance" description="Download/upload timing and aspect reliability." /><div className="stats-grid compact"><StatCard label="Ready" value={readNumber(mediaPerformance, "ready") ?? 0} tone="success" /><StatCard label="Failed" value={readNumber(mediaPerformance, "failed") ?? 0} tone={(readNumber(mediaPerformance, "failed") ?? 0) > 0 ? "warning" : "success"} /><StatCard label="Avg download" value={formatMs(readNumber(mediaPerformance, "avgDownloadMs") ?? 0)} /><StatCard label="Avg upload" value={formatMs(readNumber(mediaPerformance, "avgUploadMs") ?? 0)} /><StatCard label="Aspect warnings" value={readNumber(mediaPerformance, "aspectWarnings") ?? 0} tone={(readNumber(mediaPerformance, "aspectWarnings") ?? 0) > 0 ? "warning" : "success"} /></div></Card>
    <Card><CardHeader title="Prompt performance" description="Prompt run status and provider distribution." /><div className="stats-grid compact"><StatCard label="Runs" value={readNumber(promptPerformance, "total") ?? 0} /><StatCard label="Succeeded" value={readNumber(promptPerformance, "succeeded") ?? 0} tone="success" /><StatCard label="Failed" value={readNumber(promptPerformance, "failed") ?? 0} tone={(readNumber(promptPerformance, "failed") ?? 0) > 0 ? "warning" : "success"} /><StatCard label="Error rate" value={`${Math.round((readNumber(promptPerformance, "errorRate") ?? 0) * 100)}%`} /></div></Card>
    <Card><CardHeader title="Category performance" description="Generated and published volume by category." /><DataTable rows={categoryPerformance} columns={[{ key: "category", label: "Category" }, { key: "routes", label: "Routes" }, { key: "generated", label: "Generated" }, { key: "published", label: "Published" }, { key: "mediaFailed", label: "Media failed" }, { key: "promptRuns", label: "Prompt runs" }]} /></Card>
    <Card><CardHeader title="Provider health" description="Free fallback/download provider attempts and speed." /><DataTable rows={providerHealth} columns={[{ key: "provider", label: "Provider" }, { key: "attempts", label: "Attempts" }, { key: "success", label: "Success" }, { key: "failed", label: "Failed" }, { key: "avgMs", label: "Avg time", render: (row) => formatMs(readNumber(row, "avgMs") ?? 0) }]} /></Card>
    <Card><CardHeader title="Top blockers and failures" description="Recent media, prompt and publishing failures." /><DataTable rows={topBlockers} columns={[{ key: "kind", label: "Kind", render: (row) => <Badge tone="warning">{readString(row, "kind") ?? "failure"}</Badge> }, { key: "id", label: "ID", render: (row) => shortId(readString(row, "id")) }, { key: "error", label: "Error" }, { key: "createdAt", label: "Created" }]} /></Card>
  </div>;
}

function OverviewPage({ readinessScore, metricCards, distributions, timeseries, routes, allRoutes, outputs, bindings, issues }: { readinessScore: number; metricCards: JsonObject; distributions: JsonObject; timeseries: JsonObject | undefined; routes: JsonObject[]; allRoutes: JsonObject[]; outputs: JsonObject[]; bindings: JsonObject[]; issues: JsonObject[] }): JSX.Element {
  return <div className="page-grid">
    <Card className="hero-card"><CardHeader eyebrow="Executive overview" title="Category-aware operator dashboard" description="Review launch readiness, category topology, media flow, prompt binding health, and publishing KPIs from one source of truth." /><Progress value={readinessScore} label="Readiness score" /><div className="issue-strip">{issues.slice(0, 3).map((issue) => <Badge key={readString(issue, "code") ?? Math.random().toString()} tone={issueTone(readString(issue, "severity"))}>{readString(issue, "area")}: {readString(issue, "code")}</Badge>)}</div></Card>
    <div className="stats-grid">
      <StatCard label="Active routes" value={readNumber(metricCards, "activeRoutes") ?? routes.filter((route) => readBoolean(route, "enabled") !== false).length} helper="Enabled source categories" tone="info" />
      <StatCard label="Enabled outputs" value={readNumber(metricCards, "enabledOutputs") ?? outputs.filter((output) => readBoolean(output, "enabled") !== false).length} helper="Language/channel outputs" tone="success" />
      <StatCard label="Ready reviews" value={readNumber(metricCards, "readyForReview") ?? 0} helper="Awaiting human approval" tone="warning" />
      <StatCard label="Scheduled" value={readNumber(metricCards, "scheduled") ?? 0} helper="Queued for final channel" tone="info" />
      <StatCard label="Media pending" value={readNumber(metricCards, "mediaPending") ?? 0} helper="Dispatching or processing" tone="warning" />
      <StatCard label="Failures" value={(readNumber(metricCards, "failedOutputs") ?? 0) + (readNumber(metricCards, "mediaFailed") ?? 0)} helper="Outputs and media jobs" tone="danger" />
    </div>
    <CategoryHealthTable routes={routes} outputs={outputs} bindings={bindings} issues={issues} />
    <CategoryWorkspace routes={routes} outputs={outputs} bindings={bindings} issues={issues} scope="all" />
    <div className="chart-grid"><DonutChartCard title="Output status" description="Generated output lifecycle distribution." data={readDistribution(distributions, "outputsByStatus")} /><BarChartCard title="Languages" description="Generated output volume by language." data={readDistribution(distributions, "outputsByLanguage")} /><FunnelCard title="Media pipeline" description="Current media processor state." steps={funnelFromDistribution(readDistribution(distributions, "mediaJobsByStatus"))} /></div>
    <AnalyticsSummary timeseries={timeseries} />
  </div>;
}

function AnalyticsSummary({ timeseries }: { timeseries: JsonObject | undefined }): JSX.Element {
  const series = readObject(timeseries, "series");
  const outputs = readArray(series, "outputs");
  const published = readArray(series, "published");
  const mediaJobs = readArray(series, "mediaJobs");
  const rows = mergeDailySeries(outputs, published, mediaJobs);
  return <Card><CardHeader title="Weekly / monthly analytics" description="Daily operational trend for generated outputs, published posts, and media jobs. Range comes from the backend metrics endpoint." /><DataTable rows={rows} emptyText="No timeseries data yet." columns={[{ key: "day", label: "Day" }, { key: "outputs", label: "Outputs" }, { key: "published", label: "Published" }, { key: "mediaJobs", label: "Media jobs" }]} /></Card>;
}

function SettingsCenterPage(props: { adminConfig: AdminConfigResponse | undefined; allSettings: AdminConfigItem[]; drafts: Record<string, string>; setDrafts: (updater: (drafts: Record<string, string>) => Record<string, string>) => void; activeSection: string; setActiveSection: (value: string) => void; onSave: (item: AdminConfigItem) => Promise<void>; onReset: (item: AdminConfigItem) => Promise<void>; busy: string | undefined; saveStates: Record<string, SettingSaveState> }): JSX.Element {
  const groups = groupedSettings(props.allSettings);
  const sections = [{ id: "all", label: "All settings" }, ...Object.keys(groups).map((group) => ({ id: group, label: groupLabel(group) }))];
  const visibleItems = props.activeSection === "all" ? props.allSettings : groups[props.activeSection] ?? [];
  return <div className="page-grid"><Card className="hero-card"><CardHeader eyebrow="Settings Center" title="Editable runtime configuration" description="Draft, effective value and source are separated to avoid misleading Save behavior. Secret values are write-only." /><div className="settings-section-tabs">{sections.map((section) => <Button key={section.id} variant={props.activeSection === section.id ? "default" : "secondary"} size="sm" onClick={() => props.setActiveSection(section.id)}>{section.label}</Button>)}</div>{props.adminConfig?.adminConfigStore?.warning && <Alert title="Config store warning" tone="warning">{props.adminConfig.adminConfigStore.warning}</Alert>}</Card><SettingsEditor items={visibleItems} drafts={props.drafts} setDrafts={props.setDrafts} onSave={props.onSave} onReset={props.onReset} busy={props.busy} saveStates={props.saveStates} /></div>;
}

function AISettingsPage(props: { adminConfig: AdminConfigResponse | undefined; items: AdminConfigItem[]; drafts: Record<string, string>; setDrafts: (updater: (drafts: Record<string, string>) => Record<string, string>) => void; onSave: (item: AdminConfigItem) => Promise<void>; onReset: (item: AdminConfigItem) => Promise<void>; busy: string | undefined; saveStates: Record<string, SettingSaveState>; onTest: (input: JsonObject) => Promise<void>; testResult: JsonObject | undefined }): JSX.Element {
  const providerSetting = findSetting(props.adminConfig, "AI_PROVIDER");
  const modelSetting = findSetting(props.adminConfig, "AI_MODEL");
  const provider = settingValue(providerSetting ?? ({ key: "AI_PROVIDER", isSecret: false, value: "mock" } as AdminConfigItem), props.drafts) || "mock";
  const model = settingValue(modelSetting ?? ({ key: "AI_MODEL", isSecret: false, value: "mock" } as AdminConfigItem), props.drafts) || "mock";
  return <div className="page-grid"><Card className="hero-card"><CardHeader eyebrow="AI Settings" title="Provider, models, keys, and output behavior" description="Use mock for safe demos, or configure OpenAI/Gemini/custom credentials for real AI output generation." /><div className="settings-hint-grid"><ProviderPreset title="OpenAI presets" values={props.adminConfig?.presets?.openai ?? aiModelPresets.openai} /><ProviderPreset title="Gemini presets" values={props.adminConfig?.presets?.gemini ?? aiModelPresets.gemini} /><Alert title="AI test" tone="info">Run a safe readiness test. Mock does not call external services; real providers require configured API keys.</Alert></div><div className="button-row"><Button variant="secondary" disabled={props.busy !== undefined} onClick={() => void props.onTest({ provider, model, prompt: "Return a compact JSON hello in Persian.", runReal: provider !== "mock" })}>Test selected AI provider</Button></div>{props.testResult && <pre>{JSON.stringify(props.testResult, null, 2)}</pre>}</Card><SettingsEditor items={props.items} drafts={props.drafts} setDrafts={props.setDrafts} onSave={props.onSave} onReset={props.onReset} busy={props.busy} saveStates={props.saveStates} /></div>;
}

function ProvidersPage(props: { summary: JsonObject | undefined; items: AdminConfigItem[]; drafts: Record<string, string>; setDrafts: (updater: (drafts: Record<string, string>) => Record<string, string>) => void; onSave: (item: AdminConfigItem) => Promise<void>; onReset: (item: AdminConfigItem) => Promise<void>; busy: string | undefined; saveStates: Record<string, SettingSaveState>; onTest: (provider: string) => Promise<void>; testResult: JsonObject | undefined }): JSX.Element {
  const providers = readObject(props.summary, "providers");
  return <div className="page-grid"><Card className="hero-card"><CardHeader eyebrow="Provider Settings" title="Social source and scraping providers" description="Configure provider-assisted ingestion without enabling real providers accidentally." /><div className="stats-grid compact"><StatCard label="Mode" value={readString(providers, "providersMode") ?? "mock"} tone="info" /><StatCard label="Setup required" value={readBoolean(providers, "setupRequired") ? "Yes" : "No"} tone={readBoolean(providers, "setupRequired") ? "warning" : "success"} /><StatCard label="Setup satisfied" value={readBoolean(providers, "setupSatisfied") ? "Yes" : "No"} tone={readBoolean(providers, "setupSatisfied") ? "success" : "warning"} /></div><div className="button-row"><Button variant="secondary" onClick={() => void props.onTest("mock")} disabled={props.busy !== undefined}>Test mock</Button><Button variant="secondary" onClick={() => void props.onTest("firecrawl")} disabled={props.busy !== undefined}>Test Firecrawl</Button><Button variant="secondary" onClick={() => void props.onTest("apify")} disabled={props.busy !== undefined}>Test Apify</Button><Button variant="secondary" onClick={() => void props.onTest("getxapi")} disabled={props.busy !== undefined}>Test GetXAPI</Button></div>{props.testResult && <pre>{JSON.stringify(props.testResult, null, 2)}</pre>}<Alert title="Provider tests" tone="info">Provider tests check credential readiness. Firecrawl can run a live network test from the backend when explicitly requested in the API.</Alert></Card><SettingsEditor items={props.items} drafts={props.drafts} setDrafts={props.setDrafts} onSave={props.onSave} onReset={props.onReset} busy={props.busy} saveStates={props.saveStates} /></div>;
}

function TelegramSettingsPage(props: { summary: JsonObject | undefined; items: AdminConfigItem[]; routes: JsonObject[]; outputs: JsonObject[]; drafts: Record<string, string>; setDrafts: (updater: (drafts: Record<string, string>) => Record<string, string>) => void; onSave: (item: AdminConfigItem) => Promise<void>; onReset: (item: AdminConfigItem) => Promise<void>; busy: string | undefined; saveStates: Record<string, SettingSaveState>; onTest: (input: JsonObject) => Promise<void>; testResult: JsonObject | undefined }): JSX.Element {
  const telegram = readObject(props.summary, "telegram");
  const topicWorkflow = readObject(telegram, "topicWorkflow");
  const publishing = readObject(props.summary, "publishing");
  const secretSources = readObject(props.summary, "secretSources");
  const telegramBotSource = readString(secretSources, "telegramBotToken") ?? (readBoolean(topicWorkflow, "botTokenConfigured") ? "env_or_worker_secret" : "missing");
  const firstOutput = props.outputs[0];
  const reviewChatId = readString(firstOutput, "reviewChatId") ?? readString(telegram, "reviewChatId") ?? "";
  const reviewThreadId = readNumber(firstOutput, "reviewThreadId");
  const finalChatId = readString(firstOutput, "finalChatId") ?? "";
  const finalPublishingEnabled = readBoolean(publishing, "finalPublishingEnabled") ?? readBoolean(topicWorkflow, "finalPublishingEnabled") ?? false;
  return <div className="page-grid"><Card className="hero-card"><CardHeader eyebrow="Telegram Setup" title="Bot, topics, reviewers, and final channels" description="Source topics feed routes. Review topics are human control points. Media Registry is internal infrastructure. Final channels are public outputs." /><div className="stats-grid compact"><StatCard label="Bot token" value={telegramBotSource === "missing" ? "Missing" : telegramBotSource} tone={telegramBotSource === "missing" ? "warning" : "success"} /><StatCard label="Routes" value={readNumber(topicWorkflow, "routeCount") ?? props.routes.length} /><StatCard label="Final publishing" value={finalPublishingEnabled ? "Enabled" : "Disabled"} tone={finalPublishingEnabled ? "warning" : "muted"} helper="Shared source with Publishing tab." /></div><div className="button-row"><Button variant="secondary" onClick={() => void props.onTest({ kind: "bot" })} disabled={props.busy !== undefined}>Test bot token</Button><Button variant="secondary" onClick={() => void props.onTest(telegramTestPayload(reviewChatId, reviewThreadId))} disabled={props.busy !== undefined || !reviewChatId}>Test review topic</Button><Button variant="secondary" onClick={() => void props.onTest(telegramTestPayload(finalChatId))} disabled={props.busy !== undefined || !finalChatId}>Test final channel reachability</Button></div>{props.testResult && <pre>{JSON.stringify(props.testResult, null, 2)}</pre>}<Alert title="Topic ID guidance" tone="info">Use numeric chat IDs and message_thread_id values. Topic names are only for humans; routing uses sourceChatId/sourceThreadId.</Alert></Card><SettingsEditor items={props.items} drafts={props.drafts} setDrafts={props.setDrafts} onSave={props.onSave} onReset={props.onReset} busy={props.busy} saveStates={props.saveStates} /><Card><CardHeader title="Routes and outputs" description="Use the Routes tab to create or edit route/output records." /><DataTable rows={props.outputs} columns={[{ key: "routeId", label: "Route" }, { key: "language", label: "Lang" }, { key: "reviewThreadId", label: "Review topic" }, { key: "finalChatId", label: "Final" }, { key: "publishMode", label: "Mode" }, { key: "permission", label: "Permission tests", render: (row) => <div className="inline-actions"><Button size="sm" variant="secondary" onClick={() => void props.onTest(telegramTestPayload(readString(row, "reviewChatId"), readNumber(row, "reviewThreadId")))} disabled={props.busy !== undefined || !readString(row, "reviewChatId")}>Review</Button><Button size="sm" variant="secondary" onClick={() => void props.onTest(telegramTestPayload(readString(row, "finalChatId")))} disabled={props.busy !== undefined || !readString(row, "finalChatId")}>Final</Button></div> }]} /></Card></div>;
}

function RoutesPage(props: { routes: JsonObject[]; outputs: JsonObject[]; promptProfiles: JsonObject[]; bindings: JsonObject[]; issues: JsonObject[]; categoryScope: string; busy: string | undefined; onSaveRoute: (route: JsonObject, existing: boolean) => Promise<void>; onDisableRoute: (routeId: string) => Promise<void>; onSaveOutput: (routeId: string, output: JsonObject, existing: boolean) => Promise<void>; onDisableOutput: (outputId: string) => Promise<void> }): JSX.Element {
  return <RouteOutputBuilder routes={props.routes} outputs={props.outputs} promptProfiles={props.promptProfiles} bindings={props.bindings} issues={props.issues} categoryScope={props.categoryScope} busy={props.busy} onSaveRoute={props.onSaveRoute} onDisableRoute={props.onDisableRoute} onSaveOutput={props.onSaveOutput} onDisableOutput={props.onDisableOutput} />;
}

function MediaPage(props: { summary: JsonObject | undefined; mediaJobs: JsonObject[]; items: AdminConfigItem[]; drafts: Record<string, string>; setDrafts: (updater: (drafts: Record<string, string>) => Record<string, string>) => void; onSave: (item: AdminConfigItem) => Promise<void>; onReset: (item: AdminConfigItem) => Promise<void>; busy: string | undefined; saveStates: Record<string, SettingSaveState>; mediaDebugUrl: string; setMediaDebugUrl: (value: string) => void; mediaDebugResult: JsonObject | undefined; onDebugMedia: () => Promise<void>; onRetryJob: (jobId: string) => Promise<void>; onCancelJob: (jobId: string) => Promise<void>; busyMediaJobId: string | undefined }): JSX.Element {
  const [selectedMediaJob, setSelectedMediaJob] = useState<JsonObject | undefined>(undefined);
  const media = readObject(props.summary, "media");
  const github = readObject(media, "github");
  const secretSources = readObject(props.summary, "secretSources");
  return <div className="page-grid">
    <Card className="hero-card"><CardHeader eyebrow="Internal Media Registry" title="Media cache, GitHub processing and review readiness" description="Media Cache remains the safest default for multi-language outputs: one upload creates reusable Telegram file IDs for every review and final channel." /><div className="stats-grid compact"><StatCard label="Mode" value={readString(media, "mode") ?? "unknown"} /><StatCard label="Cache topic" value={readString(media, "cacheThreadId") || readString(media, "stagingThreadId") || "missing"} tone={readString(media, "cacheThreadId") ? "success" : "warning"} /><StatCard label="GitHub workflow" value={readString(github, "workflowId") ?? "media-processor.yml"} helper={readString(github, "ref") ?? "main"} /><StatCard label="Media token" value={readString(secretSources, "mediaProcessorToken") ?? "unknown"} tone={readString(secretSources, "mediaProcessorToken") === "missing" ? "warning" : "success"} /></div></Card>
    <MediaPipelineDiagram />
    <MediaQualityPolicyCard media={media} />
    <Card><CardHeader title="Media debug for one URL" description="Preview which strategy the worker will use before dispatching a GitHub media job. This is a safe metadata-only check." /><div className="grid two"><Input label="Source URL" value={props.mediaDebugUrl} onChange={props.setMediaDebugUrl} placeholder="https://x.com/... or https://instagram.com/..." /><div className="button-row align-end"><Button variant="secondary" onClick={() => void props.onDebugMedia()} disabled={props.busy !== undefined}>Preview media strategy</Button></div></div>{props.mediaDebugResult && <pre>{JSON.stringify(props.mediaDebugResult, null, 2)}</pre>}</Card>
    <SettingsEditor items={props.items} drafts={props.drafts} setDrafts={props.setDrafts} onSave={props.onSave} onReset={props.onReset} busy={props.busy} saveStates={props.saveStates} />
    <Card><CardHeader title="Recent media jobs" description="Monitor processing, dispatch, workflow links, timing, asset dimensions, callbacks and Telegram file ID readiness." /><DataTable rows={props.mediaJobs} columns={[{ key: "id", label: "Job", render: (row) => shortId(readString(row, "jobId") ?? readString(row, "id")) }, { key: "itemId", label: "Item", render: (row) => shortId(readString(row, "itemId")) }, { key: "status", label: "Status", render: (row) => <Badge tone={statusTone(readString(row, "status"))}>{readString(row, "status") ?? "unknown"}</Badge> }, { key: "workflowRunId", label: "Workflow", render: (row) => workflowLink(row) }, { key: "timings", label: "Timing", render: (row) => mediaTimingSummary(row) }, { key: "assetCount", label: "Assets", render: (row) => mediaJobAssetSummary(row) }, { key: "dimensions", label: "Dimensions", render: (row) => mediaAssetDimensionSummary(row) }, { key: "sourceUrl", label: "Source", render: (row) => truncateMiddle(readString(row, "sourceUrl"), 42) }, { key: "errorMessage", label: "Error", render: (row) => truncateMiddle(readString(row, "errorMessage"), 42) }, { key: "action", label: "Action", render: (row) => <MediaJobActions row={row} busyMediaJobId={props.busyMediaJobId} onRetry={props.onRetryJob} onCancel={props.onCancelJob} onInspect={setSelectedMediaJob} /> }]} /></Card>{selectedMediaJob && <MediaJobDetailsCard job={selectedMediaJob} onClose={() => setSelectedMediaJob(undefined)} />}
  </div>;
}


function MediaQualityPolicyCard({ media }: { media: JsonObject | undefined }): JSX.Element {
  const fallbackProviders = readObject(media, "fallbackProviders");
  const videoOutput = readObject(media, "videoOutput");
  return <Card><CardHeader title="Video quality and free fallback providers" description="The media processor prefers direct/free extractors before yt-dlp, preserves aspect ratio and only transcodes when needed." /><div className="stats-grid compact"><StatCard label="Video profile" value={readString(videoOutput, "profile") ?? "telegram_review_optimized"} helper={readString(videoOutput, "transcodePolicy") ?? "copy_if_possible"} /><StatCard label="Max side" value={readNumber(videoOutput, "maxSide") ?? 1920} helper="Preserve aspect, no crop" /><StatCard label="Base CRF" value={readNumber(videoOutput, "crf") ?? 23} helper="Only if transcode is needed" /><StatCard label="Fallbacks" value={readBoolean(fallbackProviders, "enabled") === false ? "Disabled" : "Enabled"} tone={readBoolean(fallbackProviders, "enabled") === false ? "warning" : "success"} /></div><DataTable rows={[{ platform: "Twitter/X", order: readString(fallbackProviders, "xOrder") ?? "direct,gallery_dl,yt_dlp,external" }, { platform: "Instagram", order: readString(fallbackProviders, "instagramOrder") ?? "direct,gallery_dl,instaloader,yt_dlp,external" }]} columns={[{ key: "platform", label: "Platform" }, { key: "order", label: "Free fallback order" }]} /><Alert title="Quality guard" tone="info">Vertical videos should remain vertical. Square candidates are treated as suspicious unless the original media is square. The processor records original/prepared/Telegram dimensions and aspect drift for debugging.</Alert></Card>;
}

function MediaJobActions({ row, busyMediaJobId, onRetry, onCancel, onInspect }: { row: JsonObject; busyMediaJobId: string | undefined; onRetry: (jobId: string) => Promise<void>; onCancel: (jobId: string) => Promise<void>; onInspect: (row: JsonObject) => void }): JSX.Element {
  const jobId = readString(row, "jobId") ?? readString(row, "id");
  const status = readString(row, "status");
  if (!jobId) return <span className="muted-text">-</span>;
  const busy = busyMediaJobId === jobId;
  const retryable = status === "failed" || status === "skipped" || status === "pending";
  const cancellable = status === "pending" || status === "dispatching" || status === "dispatched" || status === "processing" || status === "failed";
  return <div className="inline-actions"><Button size="sm" variant="secondary" onClick={() => onInspect(row)}>Details</Button><Button size="sm" variant="secondary" onClick={() => void onRetry(jobId)} disabled={busy || !retryable}>{busy ? "Working..." : "Retry"}</Button><Button size="sm" variant="ghost" onClick={() => void onCancel(jobId)} disabled={busy || !cancellable}>Cancel</Button></div>;
}

function MediaJobDetailsCard({ job, onClose }: { job: JsonObject; onClose: () => void }): JSX.Element {
  const output = readObject(job, "output") ?? {};
  const assets = readArray(output, "assets");
  const warnings = assets.flatMap((asset) => readArrayOfStrings(asset, "warnings"));
  return <Card><CardHeader title="Media job details" description="Inspect workflow timing, callback payload, prepared assets and Telegram file readiness." action={<Button size="sm" variant="secondary" onClick={onClose}>Close</Button>} /><div className="stats-grid compact"><StatCard label="Job" value={shortId(readString(job, "jobId") ?? readString(job, "id"))} helper={readString(job, "status") ?? "status"} /><StatCard label="Workflow" value={readString(output, "githubRunId") ?? readString(job, "workflowRunId") ?? "-"} helper={readString(output, "githubRunUrl") ? "Open run link available" : "No run link"} /><StatCard label="Timing" value={mediaTimingSummary(job)} /><StatCard label="Assets" value={assets.length} helper={mediaJobAssetSummary(job)} /></div>{readString(output, "githubRunUrl") && <Alert title="GitHub workflow" tone="info"><a href={readString(output, "githubRunUrl")} target="_blank" rel="noreferrer">Open GitHub Actions run</a></Alert>}{warnings.length > 0 && <Alert title="Asset warnings" tone="warning">{warnings.join("; ")}</Alert>}<DataTable rows={assets} emptyText="No assets were returned by the processor yet." columns={[{ key: "index", label: "#" }, { key: "kind", label: "Type" }, { key: "mimeType", label: "MIME" }, { key: "width", label: "W", render: (row) => readNumber(row, "telegramWidth") ?? readNumber(row, "preparedWidth") ?? readNumber(row, "width") ?? "-" }, { key: "height", label: "H", render: (row) => readNumber(row, "telegramHeight") ?? readNumber(row, "preparedHeight") ?? readNumber(row, "height") ?? "-" }, { key: "durationSeconds", label: "Duration" }, { key: "aspectDrift", label: "Drift" }, { key: "telegramFileId", label: "file_id", render: (row) => readString(row, "telegramFileId") ? "ready" : "-" }]} /><details className="technical-details"><summary>Raw job payload</summary><pre>{JSON.stringify(job, null, 2)}</pre></details></Card>;
}

function mediaJobAssetSummary(row: JsonObject): string {

  const output = readObject(row, "output");
  const stored = readNumber(output, "storedAssetCount");
  const assetCount = readNumber(output, "assetCount");
  if (stored !== undefined) return `${stored} stored`;
  if (assetCount !== undefined) return `${assetCount} detected`;
  return "-";
}

function workflowLink(row: JsonObject): JSX.Element | string {
  const output = readObject(row, "output");
  const url = readString(output, "githubRunUrl");
  const runId = readString(output, "githubRunId") ?? readString(row, "workflowRunId");
  if (url) return <a href={url} target="_blank" rel="noreferrer">{runId ? shortId(runId) : "Open run"}</a>;
  return runId ? shortId(runId) : "-";
}

function mediaTimingSummary(row: JsonObject): string {
  const output = readObject(row, "output");
  const timings = readObject(output, "timings");
  const download = readNumber(timings, "downloadMs");
  const prepare = readNumber(timings, "prepareMs");
  const upload = readNumber(timings, "telegramUploadMs");
  const total = readNumber(timings, "totalMs");
  const parts = [
    download === undefined ? undefined : `dl ${formatMs(download)}`,
    prepare === undefined ? undefined : `prep ${formatMs(prepare)}`,
    upload === undefined ? undefined : `up ${formatMs(upload)}`,
    total === undefined ? undefined : `total ${formatMs(total)}`
  ].filter((entry): entry is string => entry !== undefined);
  return parts.length === 0 ? "-" : parts.join(" · ");
}

function mediaAssetDimensionSummary(row: JsonObject): string {
  const output = readObject(row, "output");
  const assets = readArray(output, "assets");
  if (assets.length === 0) return "-";
  return assets.slice(0, 2).map((asset) => {
    const kind = readString(asset, "kind") ?? readString(asset, "telegramFileType") ?? "asset";
    const width = readNumber(asset, "telegramWidth") ?? readNumber(asset, "preparedWidth") ?? readNumber(asset, "width");
    const height = readNumber(asset, "telegramHeight") ?? readNumber(asset, "preparedHeight") ?? readNumber(asset, "height");
    const duration = readNumber(asset, "durationSeconds");
    const drift = readNumber(asset, "aspectDrift");
    return `${kind} ${width ?? "?"}x${height ?? "?"}${duration === undefined ? "" : ` ${Math.round(duration)}s`}${drift === undefined ? "" : drift > 0.02 ? ` drift ${drift}` : ""}`;
  }).join("; ") + (assets.length > 2 ? ` +${assets.length - 2}` : "");
}

function formatMs(value: number): string {
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}s`;
  return `${Math.round(value)}ms`;
}

function truncateMiddle(value: string | undefined, maxLength: number): string {
  if (!value) return "-";
  if (value.length <= maxLength) return value;
  const side = Math.max(4, Math.floor((maxLength - 1) / 2));
  return `${value.slice(0, side)}…${value.slice(-side)}`;
}

function PublishingPage(props: { summary: JsonObject | undefined; publishQueue: JsonObject[]; outputs: JsonObject[]; items: AdminConfigItem[]; drafts: Record<string, string>; setDrafts: (updater: (drafts: Record<string, string>) => Record<string, string>) => void; onSave: (item: AdminConfigItem) => Promise<void>; onReset: (item: AdminConfigItem) => Promise<void>; busy: string | undefined; saveStates: Record<string, SettingSaveState>; onPublishNow: (queueId: string) => Promise<void>; onPreview: (queueId: string) => Promise<void>; onTimeline: (input: { itemId?: string; queueId?: string; generatedOutputId?: string }) => Promise<void>; onBulkPublishNow: (queueIds: string[]) => Promise<void>; onCancel: (queueId: string) => Promise<void>; onReschedule: (queueId: string) => Promise<void>; onRunDue: () => Promise<void>; publishPreview: JsonObject | undefined; duePublishResult: JsonObject | undefined; busyQueueId: string | undefined; queueStatusFilter: string; setQueueStatusFilter: (value: string) => void; queueSearch: string; setQueueSearch: (value: string) => void; onEditRoutes: () => void }): JSX.Element {
  const publishing = readObject(props.summary, "publishing");
  const secrets = readObject(props.summary, "secrets");
  const telegram = readObject(props.summary, "telegram");
  const topicWorkflow = readObject(telegram, "topicWorkflow");
  const queueCounts = readObject(publishing, "queueCounts");
  const filteredQueue = filterQueue(props.publishQueue, props.queueStatusFilter, props.queueSearch);
  const finalEnabled = readBoolean(publishing, "finalPublishingEnabled") === true;
  const schedulerEnabled = readBoolean(publishing, "publishSchedulerEnabled") === true;
  const dryRun = readBoolean(publishing, "dryRun") === true;
  const secretSources = readObject(props.summary, "secretSources");
  const telegramBotSetting = props.items.find((item) => item.key === "TELEGRAM_BOT_TOKEN");
  const telegramBotSource = readString(secretSources, "telegramBotToken") ?? telegramBotSetting?.source;
  const telegramBotConfigured =
    readBoolean(secrets, "telegramBotToken") === true ||
    readBoolean(topicWorkflow, "botTokenConfigured") === true ||
    (telegramBotSource !== undefined && telegramBotSource !== "missing") ||
    (telegramBotSetting?.configured === true && telegramBotSetting.source !== "missing");
  const criticalSettings = props.items.filter((item) => criticalPublishingSettingKeys.has(item.key));
  const secondarySettings = props.items.filter((item) => !criticalPublishingSettingKeys.has(item.key));
  const dueQueueCount = (readNumber(queueCounts, "pending") ?? 0) + (readNumber(queueCounts, "scheduled") ?? 0);
  return <div className="page-grid"><Card className="hero-card"><CardHeader eyebrow="Publishing Control" title="Manual publishing, scheduler and per-output timing" description="Preview the exact caption/media/prompt state before publishing. Timing lives on route outputs; scheduler only processes due queue items." action={<Button variant="secondary" onClick={() => void props.onRunDue()} disabled={props.busy !== undefined}>Run due publishing</Button>} /><div className="stats-grid compact"><StatCard label="Final publishing" value={finalEnabled ? "Enabled" : "Disabled"} tone={finalEnabled ? "warning" : "muted"} helper={finalEnabled ? "Manual/final send may publish." : "Send will only queue or schedule."} /><StatCard label="Publish scheduler" value={schedulerEnabled ? "Enabled" : "Disabled"} tone={schedulerEnabled ? "success" : "warning"} helper={dryRun ? "Dry-run is enabled." : "Processes due items."} /><StatCard label="Due queue" value={dueQueueCount} helper="pending + scheduled" tone={dueQueueCount > 0 ? "warning" : "success"} /><StatCard label="Cron" value={readString(publishing, "workerCron") ?? "*/30 * * * *"} helper="Configured in wrangler.toml" /></div>{dryRun && <Alert title="Scheduler dry-run" tone="warning">Scheduler dry-run is enabled. Automatic scheduler work is simulated and will not publish final posts.</Alert>}<Alert title="Manual publish safety" tone="warning">Use Preview before Publish now. Rows with pending/failed media expose blockers in the preview and backend.</Alert></Card><Card className="hero-card"><CardHeader eyebrow="Critical controls" title="Final Telegram publishing switches" description="These switches are saved through the backend admin config store and affect the effective Worker runtime. They are intentionally repeated here because Send and the cron publish runner depend on both." /><div className="stats-grid compact"><StatCard label="Bot token" value={telegramBotConfigured ? "Configured" : "Missing"} tone={telegramBotConfigured ? "success" : "danger"} helper="Required for real review and final publish." /><StatCard label="Final publish" value={finalEnabled ? "On" : "Off"} tone={finalEnabled ? "warning" : "muted"} helper={finalEnabled ? "Approved output can publish." : "Send will not hit final channels."} /><StatCard label="Due scheduler" value={schedulerEnabled ? "On" : "Off"} tone={schedulerEnabled ? "success" : "warning"} helper={schedulerEnabled ? "Cron checks due queue." : "Use Run due publishing manually."} /><StatCard label="Due limit" value={readNumber(publishing, "dueLimit") ?? "-"} /></div><PublishingControlsAlert finalEnabled={finalEnabled} schedulerEnabled={schedulerEnabled} botConfigured={telegramBotConfigured} dryRun={dryRun} />{criticalSettings.length > 0 ? <SettingsEditor items={criticalSettings} drafts={props.drafts} setDrafts={props.setDrafts} onSave={props.onSave} onReset={props.onReset} busy={props.busy} saveStates={props.saveStates} /> : <Alert title="Critical settings not found" tone="danger">The backend did not return TELEGRAM_FINAL_PUBLISH_ENABLED, TELEGRAM_PUBLISH_SCHEDULER_ENABLED, or TELEGRAM_PUBLISH_DUE_LIMIT. Apply migrations and verify the admin config allowlist.</Alert>}</Card>{props.duePublishResult && <PublishDueOutcome result={props.duePublishResult} />}{props.publishPreview && <PublishPreviewCard preview={props.publishPreview} />}<RouteTimingSummary outputs={props.outputs} onEditRoutes={props.onEditRoutes} /><Card><CardHeader title="Publish queue" description="Media and prompt status are shown per queue row so final publishing is not blind." /><div className="grid two"><Select label="Status filter" value={props.queueStatusFilter} onChange={props.setQueueStatusFilter} options={["all", "pending", "scheduled", "failed", "published", "publishing"].map((value) => ({ value, label: value }))} /><Input label="Search queue/final/output" value={props.queueSearch} onChange={props.setQueueSearch} placeholder="queueId, generatedOutputId, @channel" /></div><PublishQueueTable rows={filteredQueue} onPublishNow={props.onPublishNow} onPreview={props.onPreview} onTimeline={props.onTimeline} onBulkPublishNow={props.onBulkPublishNow} onCancel={props.onCancel} onReschedule={props.onReschedule} busyQueueId={props.busyQueueId} /></Card>{secondarySettings.length > 0 && <SettingsEditor items={secondarySettings} drafts={props.drafts} setDrafts={props.setDrafts} onSave={props.onSave} onReset={props.onReset} busy={props.busy} saveStates={props.saveStates} />}</div>;
}

function PublishingControlsAlert({ finalEnabled, schedulerEnabled, botConfigured, dryRun }: { finalEnabled: boolean; schedulerEnabled: boolean; botConfigured: boolean; dryRun: boolean }): JSX.Element {
  if (!botConfigured) return <Alert title="Bot token missing" tone="danger">TELEGRAM_BOT_TOKEN is not configured. Final publishing will fail even when the publishing switches are on.</Alert>;
  if (!finalEnabled) return <Alert title="Final publishing is off" tone="warning">Review Send will approve and queue or schedule outputs, but it will not publish to final Telegram channels until TELEGRAM_FINAL_PUBLISH_ENABLED is enabled.</Alert>;
  if (!schedulerEnabled) return <Alert title="Publish scheduler is off" tone="warning">Manual Publish now can work, but the 30-minute Worker cron will not process due Telegram queue items until TELEGRAM_PUBLISH_SCHEDULER_ENABLED is enabled.</Alert>;
  if (dryRun) return <Alert title="Scheduler dry-run is on" tone="warning">Publishing switches are on, but SCHEDULER_DRY_RUN is still enabled. Run due publishing manually for a backend-confirmed check before relying on cron.</Alert>;
  return <Alert title="Publishing path is enabled" tone="success">Final publishing and the due queue scheduler are enabled. Due scheduled outputs should be processed by the next Worker cron tick.</Alert>;
}

function PublishPreviewCard({ preview }: { preview: JsonObject }): JSX.Element {
  const media = readObject(preview, "media");
  const prompt = readObject(preview, "prompt");
  const blockers = readArrayOfStrings(preview, "blockers");
  const warnings = readArrayOfStrings(preview, "warnings");
  const assets = readArray(media, "assets");
  return <Card><CardHeader title="Publish now preview" description="This is the backend preview used before sending to the final channel." /><div className="stats-grid compact"><StatCard label="Output" value={readString(preview, "routeOutputId") ?? "-"} helper={readString(preview, "category") ?? "category"} /><StatCard label="Final" value={readString(preview, "finalChatId") ?? "-"} /><StatCard label="Media" value={readString(media, "status") ?? "unknown"} helper={`${readNumber(media, "readyAssetCount") ?? 0}/${readNumber(media, "assetCount") ?? 0} ready`} tone={blockers.length > 0 ? "danger" : warnings.length > 0 ? "warning" : "success"} /><StatCard label="Prompt" value={readString(prompt, "promptProfileId") ?? "-"} helper={readString(prompt, "status") ?? "unknown"} /></div>{blockers.length > 0 && <Alert title="Publish blockers" tone="danger">{blockers.join("; ")}</Alert>}{warnings.length > 0 && <Alert title="Publish warnings" tone="warning">{warnings.join("; ")}</Alert>}<div className="grid two"><Textarea label="Caption preview" value={readString(preview, "captionPreview") ?? ""} onChange={() => undefined} rows={8} /><div><strong>Media assets</strong><DataTable rows={assets.slice(0, 10)} emptyText="No media assets." columns={[{ key: "kind", label: "Type" }, { key: "status", label: "Status" }, { key: "width", label: "W" }, { key: "height", label: "H" }, { key: "durationSeconds", label: "Sec" }, { key: "telegramFileIdConfigured", label: "file_id" }]} /></div></div></Card>;
}

function PublishDueOutcome({ result }: { result: JsonObject }): JSX.Element {
  const rows = readArray(result, "results");
  return <Card><CardHeader title="Due publishing outcome" description="Last manual due-publishing run with skipped and failed reasons." /><div className="stats-grid compact"><StatCard label="Due" value={readNumber(result, "dueCount") ?? 0} /><StatCard label="Checked" value={readNumber(result, "checkedCount") ?? 0} /><StatCard label="Published" value={readNumber(result, "publishedCount") ?? 0} tone="success" /><StatCard label="Skipped" value={readNumber(result, "skippedCount") ?? 0} tone="warning" /><StatCard label="Failed" value={readNumber(result, "failedCount") ?? 0} tone="danger" /></div><DataTable rows={rows} emptyText="No items were checked." columns={[{ key: "queueId", label: "Queue", render: (row) => shortId(readString(row, "queueId")) }, { key: "generatedOutputId", label: "Output", render: (row) => shortId(readString(row, "generatedOutputId")) }, { key: "status", label: "Status", render: (row) => <Badge tone={statusTone(readString(row, "status"))}>{readString(row, "status") ?? "unknown"}</Badge> }, { key: "message", label: "Message" }]} /></Card>;
}


function DiagnosticsPage({ issues, validation, summary, routes, onExport, adminExport, importInput, setImportInput, onPreviewImport, importPreview, testDataResult, onRefreshTestData, onResetTestData, dedupeUrl, setDedupeUrl, dedupeResult, onSearchDedupe, busy }: { issues: JsonObject[]; validation: JsonObject | undefined; summary: JsonObject | undefined; routes: JsonObject[]; onExport: () => Promise<void>; adminExport: JsonObject | undefined; importInput: string; setImportInput: (value: string) => void; onPreviewImport: () => void; importPreview: JsonObject | undefined; testDataResult: JsonObject | undefined; onRefreshTestData: () => Promise<void>; onResetTestData: (scope: string, confirm: string, sourceUrl?: string) => Promise<void>; dedupeUrl: string; setDedupeUrl: (value: string) => void; dedupeResult: JsonObject | undefined; onSearchDedupe: () => Promise<void>; busy: string | undefined }): JSX.Element {
  const [resetScope, setResetScope] = useState("all_operational");
  const [resetConfirm, setResetConfirm] = useState("");
  const [resetUrl, setResetUrl] = useState("");
  const rows = issues.map((issue) => {
    const routeId = readString(issue, "routeId");
    const route = routes.find((entry) => readString(entry, "id") === routeId);
    return { ...issue, category: readString(route, "category") ?? "global", outputId: readString(issue, "outputId") ?? "-", relatedSetting: relatedSettingForIssue(issue), impact: issueImpact(issue) };
  });
  return <div className="page-grid"><Card><CardHeader eyebrow="Diagnostics" title="Actionable launch checks" description="Every blocker should show category/output context, impact and next action." action={<Button variant="secondary" onClick={() => void onExport()}>Load safe export</Button>} /><DataTable rows={rows} columns={[{ key: "severity", label: "Severity", render: (row) => <Badge tone={issueTone(readString(row, "severity"))}>{readString(row, "severity") ?? "info"}</Badge> }, { key: "category", label: "Category" }, { key: "outputId", label: "Output" }, { key: "area", label: "Area" }, { key: "code", label: "Code" }, { key: "message", label: "Message" }, { key: "impact", label: "Impact" }, { key: "action", label: "Action" }, { key: "relatedSetting", label: "Fix area" }]} /></Card><SecretOverview summary={summary} /><Card><CardHeader title="Dedupe search and URL reset" description="Paste a source URL to inspect matched items, generated outputs, media jobs, reviews and queue rows before resetting history." /><Input label="Source URL" value={dedupeUrl} onChange={setDedupeUrl} placeholder="https://..." /><div className="button-row"><Button variant="secondary" onClick={() => void onSearchDedupe()} disabled={busy !== undefined || dedupeUrl.trim().length === 0}>Search URL history</Button><Button variant="destructive" onClick={() => void onResetTestData("url_history", "RESET STAGING", dedupeUrl)} disabled={busy !== undefined || dedupeUrl.trim().length === 0}>Reset this URL in staging</Button></div>{dedupeResult && <pre>{JSON.stringify(dedupeResult, null, 2)}</pre>}</Card><Card><CardHeader title="Staging test data reset" description="Available only when the Worker environment is staging. Routes, prompts, settings and secrets are preserved." /><div className="grid two"><Select label="Reset scope" value={resetScope} onChange={setResetScope} options={["dedupe_only", "outputs_only", "media_only", "queue_only", "reviews_only", "all_operational", "url_history"].map((value) => ({ value, label: value }))} /><Input label="Confirmation" value={resetConfirm} onChange={setResetConfirm} placeholder="Type RESET STAGING" /></div>{resetScope === "url_history" && <Input label="Source URL" value={resetUrl} onChange={setResetUrl} placeholder="https://..." />}<div className="button-row"><Button variant="secondary" onClick={() => void onRefreshTestData()} disabled={busy !== undefined}>Refresh counts</Button><Button variant="destructive" onClick={() => void onResetTestData(resetScope, resetConfirm, resetUrl)} disabled={busy !== undefined || resetConfirm !== "RESET STAGING"}>Reset staging data</Button></div>{testDataResult && <pre>{JSON.stringify(testDataResult, null, 2)}</pre>}</Card><Card><CardHeader title="Config import preview" description="Paste a safe export to inspect route/output/media/AI counts before applying anything. This preview does not mutate D1." /><Textarea label="Import JSON" value={importInput} onChange={setImportInput} rows={8} placeholder="Paste config export JSON here" /><Button variant="secondary" onClick={onPreviewImport}>Preview import</Button>{importPreview && <pre>{JSON.stringify(importPreview, null, 2)}</pre>}</Card>{adminExport && <Card><CardHeader title="Safe config export" description="Useful for backup, handoff, and clone planning. Secrets are excluded." /><pre>{JSON.stringify(adminExport, null, 2)}</pre></Card>}<Card><CardHeader title="Raw validation" description="Technical payload for debugging." /><pre>{JSON.stringify(validation ?? {}, null, 2)}</pre></Card></div>;
}


function ActivityPage({ mediaJobs, publishQueue, onPublishNow, onBulkPublishNow, onPreview, onTimeline, onCancel, onReschedule, busyQueueId, timelineInput, setTimelineInput, timelineResult }: { mediaJobs: JsonObject[]; publishQueue: JsonObject[]; onPublishNow: (queueId: string) => Promise<void>; onBulkPublishNow: (queueIds: string[]) => Promise<void>; onPreview: (queueId: string) => Promise<void>; onTimeline: (input: { itemId?: string; queueId?: string; generatedOutputId?: string; sourceUrl?: string }) => Promise<void>; onCancel: (queueId: string) => Promise<void>; onReschedule: (queueId: string) => Promise<void>; busyQueueId: string | undefined; timelineInput: string; setTimelineInput: (value: string) => void; timelineResult: JsonObject | undefined }): JSX.Element {
  return <div className="page-grid"><Card><CardHeader title="Item timeline" description="Trace one item from input through prompt, media, review, queue and final publish." /><div className="grid two"><Input label="Item / queue / output / URL" value={timelineInput} onChange={setTimelineInput} placeholder="item_..., tgpub_..., tgout_..., https://..." /><div className="button-row"><Button variant="secondary" onClick={() => void onTimeline(guessTimelineTarget(timelineInput))} disabled={timelineInput.trim().length === 0}>Load timeline</Button></div></div>{timelineResult && <TimelineView timeline={timelineResult} />}</Card><Card><CardHeader title="Publish queue" description="Scheduled and due items by final channel." /><PublishQueueTable rows={publishQueue} onPublishNow={onPublishNow} onPreview={onPreview} onTimeline={onTimeline} onBulkPublishNow={onBulkPublishNow} onCancel={onCancel} onReschedule={onReschedule} busyQueueId={busyQueueId} /></Card><Card><CardHeader title="Media jobs" description="Latest media processing jobs and errors." /><DataTable rows={mediaJobs} columns={[{ key: "id", label: "Job", render: (row) => shortId(readString(row, "jobId") ?? readString(row, "id")) }, { key: "itemId", label: "Item", render: (row) => shortId(readString(row, "itemId")) }, { key: "status", label: "Status", render: (row) => <Badge tone={statusTone(readString(row, "status"))}>{readString(row, "status") ?? "unknown"}</Badge> }, { key: "workflowRunId", label: "Workflow", render: (row) => workflowLink(row) }, { key: "timings", label: "Timing", render: (row) => mediaTimingSummary(row) }, { key: "assets", label: "Assets", render: (row) => mediaAssetDimensionSummary(row) }, { key: "errorMessage", label: "Error" }]} /></Card></div>;
}

function TimelineView({ timeline }: { timeline: JsonObject }): JSX.Element {
  const rows = readArray(timeline, "events");
  return <DataTable rows={rows} emptyText="No timeline events found." columns={[{ key: "at", label: "Time" }, { key: "kind", label: "Event", render: (row) => <Badge tone="info">{readString(row, "kind") ?? "event"}</Badge> }, { key: "status", label: "Status" }, { key: "message", label: "Message", render: (row) => readString(row, "message") ?? readString(row, "error") ?? readString(row, "sourceUrl") ?? readString(row, "canonicalUrl") ?? "-" }, { key: "id", label: "ID", render: (row) => shortId(readString(row, "queueId") ?? readString(row, "generatedOutputId") ?? readString(row, "jobId") ?? readString(row, "promptRunId") ?? readString(row, "itemId")) }]} />;
}



function ToastStack({ toasts, onDismiss }: { toasts: ToastRecord[]; onDismiss: (id: string) => void }): JSX.Element | null {
  if (toasts.length === 0) return null;
  return <div className="toast-stack">{toasts.map((toast) => <div key={toast.id} className={`toast toast-${toast.tone}`}><div><strong>{toast.title}</strong><p>{toast.message}</p>{toast.details !== undefined && <details><summary>Details</summary><pre>{JSON.stringify(toast.details, null, 2)}</pre></details>}</div><button type="button" onClick={() => onDismiss(toast.id)} aria-label="Dismiss toast">×</button></div>)}</div>;
}

function toastDurationMs(tone: ToastTone, details?: JsonValue): number {
  if (details !== undefined) return 12000;
  if (tone === "danger") return 10000;
  if (tone === "warning") return 8000;
  return 5000;
}

function readDistributionObject(value: JsonObject): Record<string, number> {
  return Object.fromEntries(Object.entries(value).filter(([, raw]) => typeof raw === "number")) as Record<string, number>;
}

function TechnicalPage({ statusBundle, summary, metrics, timeseries, adminConfig, promptStudio }: { statusBundle: StatusBundle; summary: JsonObject | undefined; metrics: JsonObject | undefined; timeseries: JsonObject | undefined; adminConfig: AdminConfigResponse | undefined; promptStudio: JsonObject | undefined }): JSX.Element {
  return <div className="page-grid"><Card><CardHeader title="Raw Worker status" description="Debug only." /><pre>{JSON.stringify(statusBundle, null, 2)}</pre></Card><Card><CardHeader title="Admin summary" description="Redacted admin payload." /><pre>{JSON.stringify(summary ?? {}, null, 2)}</pre></Card><Card><CardHeader title="Admin config" description="Settings metadata and sources." /><pre>{JSON.stringify(adminConfig ?? {}, null, 2)}</pre></Card><Card><CardHeader title="Metrics" description="Data dashboard payload." /><pre>{JSON.stringify(metrics ?? {}, null, 2)}</pre></Card><Card><CardHeader title="Timeseries" description="Daily trend payload." /><pre>{JSON.stringify(timeseries ?? {}, null, 2)}</pre></Card><Card><CardHeader title="Prompt Studio" description="Prompt profiles and bindings." /><pre>{JSON.stringify(promptStudio ?? {}, null, 2)}</pre></Card></div>;
}

const criticalPublishingSettingKeys = new Set(["TELEGRAM_FINAL_PUBLISH_ENABLED", "TELEGRAM_PUBLISH_SCHEDULER_ENABLED", "TELEGRAM_PUBLISH_DUE_LIMIT"]);

const tabs: Array<{ id: DashboardTab; label: string; icon: string }> = [
  { id: "overview", label: "Overview", icon: "◌" },
  { id: "operations", label: "Operations", icon: "◆" },
  { id: "categories", label: "Categories", icon: "▦" },
  { id: "curation", label: "Curation", icon: "⚡" },
  { id: "setup", label: "Setup", icon: "✓" },
  { id: "settings", label: "Settings", icon: "⚙" },
  { id: "ai", label: "AI", icon: "✦" },
  { id: "providers", label: "Providers", icon: "⌁" },
  { id: "telegram", label: "Telegram", icon: "✉" },
  { id: "routes", label: "Routes", icon: "⌘" },
  { id: "media", label: "Media", icon: "▣" },
  { id: "prompts", label: "Prompts", icon: "✎" },
  { id: "publishing", label: "Publishing", icon: "↗" },
  { id: "diagnostics", label: "Diagnostics", icon: "!" },
  { id: "activity", label: "Activity", icon: "↻" },
  { id: "technical", label: "Technical", icon: "{}" }
];

function ProviderPreset({ title, values }: { title: string; values: string[] }): JSX.Element {
  return <div className="preset-card"><strong>{title}</strong><div>{values.map((value) => <Badge key={value} tone="info">{value}</Badge>)}</div></div>;
}

function connectionNotice(statusResult: StatusBundle, summaryResult: ApiResult, validationResult: ApiResult): string {
  const connection = describeConnectionBundle(statusResult);
  if (connection === "unreachable" || connection === "cors_blocked") return "Worker URL is not reachable. Check the URL or deployment target.";
  if (!summaryResult.ok && summaryResult.status === 401) return "Worker reachable, but admin secret failed. Check the Admin secret or paste it again.";
  if (!summaryResult.ok) return summaryResult.message;
  if (!validationResult.ok) return validationResult.message;
  const readiness = readObject(summaryResult.data, "readiness");
  return `Dashboard refreshed. Readiness: ${readString(readiness, "label") ?? "unknown"}.`;
}

function connectionGuidance(connectionState: string, savedUrl: string, summary: JsonObject | undefined, validation: JsonObject | undefined): JSX.Element | null {
  const issues = readArray(validation ?? summary, "issues");
  if (connectionState === "connected" && issues.length === 0) return null;
  const tone = connectionState === "connected" ? "info" : connectionState === "unreachable" || connectionState === "cors_blocked" ? "danger" : "warning";
  return <Alert title="Connection guidance" tone={tone}>Current Worker URL: <strong>{savedUrl || "not saved"}</strong>. If public status works but admin calls fail, paste the Admin secret again. If the URL is wrong, clear the connection and save the correct Worker URL.</Alert>;
}

function activeTabLabel(tab: DashboardTab): string {
  return tabs.find((entry) => entry.id === tab)?.label ?? tab;
}

function summaryNotice(summaryResult: ApiResult, validationResult: ApiResult): string {
  if (!summaryResult.ok) return summaryResult.message;
  if (!validationResult.ok) return validationResult.message;
  const readiness = readObject(summaryResult.data, "readiness");
  return `Dashboard refreshed. Readiness: ${readString(readiness, "label") ?? "unknown"}.`;
}

function readObject(value: unknown, key?: string): JsonObject | undefined {
  const source = key === undefined ? value : typeof value === "object" && value !== null && !Array.isArray(value) ? (value as JsonObject)[key] : undefined;
  return typeof source === "object" && source !== null && !Array.isArray(source) ? source as JsonObject : undefined;
}

function readArray(value: unknown, key?: string): JsonObject[] {
  const source = key === undefined ? value : typeof value === "object" && value !== null && !Array.isArray(value) ? (value as JsonObject)[key] : undefined;
  return Array.isArray(source) ? source.filter((entry): entry is JsonObject => typeof entry === "object" && entry !== null && !Array.isArray(entry)) : [];
}

function readArrayOfStrings(value: unknown, key: string): string[] {
  const object = readObject(value);
  const raw = object?.[key];
  return Array.isArray(raw) ? raw.filter((entry): entry is string => typeof entry === "string") : [];
}

function shortId(value: string | undefined): string {
  if (!value) return "-";
  if (value.length <= 14) return value;
  return `${value.slice(0, 8)}…${value.slice(-4)}`;
}

function readString(value: unknown, key: string): string | undefined {
  const object = readObject(value);
  const raw = object?.[key];
  return typeof raw === "string" ? raw : undefined;
}

function readNumber(value: unknown, key: string): number | undefined {
  const object = readObject(value);
  const raw = object?.[key];
  return typeof raw === "number" ? raw : undefined;
}

function readBoolean(value: unknown, key: string): boolean | undefined {
  const object = readObject(value);
  const raw = object?.[key];
  return typeof raw === "boolean" ? raw : undefined;
}

function readBooleanValue(value: unknown): boolean {
  return value === true;
}

function readDistribution(value: unknown, key: string): Record<string, number> {
  const object = readObject(value, key);
  if (!object) return {};
  return Object.fromEntries(Object.entries(object).filter(([, raw]) => typeof raw === "number")) as Record<string, number>;
}

function funnelFromDistribution(data: Record<string, number>): Array<{ label: string; value: number }> {
  return [
    { label: "Pending", value: data.pending ?? 0 },
    { label: "Dispatched", value: (data.dispatching ?? 0) + (data.dispatched ?? 0) },
    { label: "Processing", value: data.processing ?? 0 },
    { label: "Ready", value: data.ready ?? 0 },
    { label: "Failed", value: data.failed ?? 0 }
  ];
}

function telegramTestPayload(chatId: string | undefined, threadId?: number): JsonObject {
  const payload: JsonObject = { kind: "chat_action" };
  if (chatId !== undefined && chatId.length > 0) payload.chatId = chatId;
  if (threadId !== undefined) payload.threadId = threadId;
  return payload;
}

function mergeDailySeries(outputs: JsonObject[], published: JsonObject[], mediaJobs: JsonObject[]): Array<{ day: string; outputs: number; published: number; mediaJobs: number }> {
  const days = new Set<string>();
  for (const row of [...outputs, ...published, ...mediaJobs]) {
    const day = readString(row, "day");
    if (day) days.add(day);
  }
  return Array.from(days).sort().map((day) => ({ day, outputs: countForDay(outputs, day), published: countForDay(published, day), mediaJobs: countForDay(mediaJobs, day) })).slice(-30);
}

function countForDay(rows: JsonObject[], day: string): number {
  return readNumber(rows.find((row) => readString(row, "day") === day), "count") ?? 0;
}

function filterQueue(queue: JsonObject[], statusFilter: string, search: string): JsonObject[] {
  const normalizedSearch = search.trim().toLowerCase();
  return queue.filter((item) => {
    const status = readString(item, "status") ?? "unknown";
    const statusMatch = statusFilter === "all" || status === statusFilter;
    const searchText = ["queueId", "generatedOutputId", "itemId", "finalChatId", "language"].map((key) => readString(item, key) ?? "").join(" ").toLowerCase();
    return statusMatch && (normalizedSearch.length === 0 || searchText.includes(normalizedSearch));
  });
}

function guessTimelineTarget(value: string): { itemId?: string; queueId?: string; generatedOutputId?: string; sourceUrl?: string } {
  const target = value.trim();
  if (target.startsWith("http://") || target.startsWith("https://")) return { sourceUrl: target };
  if (target.startsWith("tgpub_")) return { queueId: target };
  if (target.startsWith("tgout_")) return { generatedOutputId: target };
  return target.length > 0 ? { itemId: target } : {};
}

function issueImpact(issue: JsonObject): string { const area = readString(issue, "area") ?? "general"; if (area === "prompts") return "Prompt selection may fall back to defaults or fail silently."; if (area === "publishing") return "Approved content may stay queued or publish unsafely."; if (area === "media") return "Reviews may miss media or duplicate text-only output."; if (area === "telegram") return "Bot may not reach review/final targets."; return "Review before launch."; }

function issueTone(value: string | undefined): "success" | "warning" | "danger" | "info" | "muted" {
  if (value === "error") return "danger";
  if (value === "warning") return "warning";
  if (value === "success") return "success";
  return "info";
}

function statusTone(value: string | undefined): "success" | "warning" | "danger" | "info" | "muted" {
  if (value === "ready" || value === "published" || value === "ready_for_review" || value === "active") return "success";
  if (value === "failed" || value === "cancelled") return "danger";
  if (value === "pending" || value === "processing" || value === "scheduled") return "warning";
  return "info";
}

// ============================================================
// CURATION PAGE
// ============================================================

function CurationPage(props: {
  client: WorkerApiClient;
  runs: JsonObject[];
  setRuns: (runs: JsonObject[]) => void;
  decisions: JsonObject[];
  setDecisions: (decisions: JsonObject[]) => void;
  busy: boolean;
  setBusy: (busy: boolean) => void;
  triggerResult: JsonObject | undefined;
  setTriggerResult: (result: JsonObject | undefined) => void;
  toast: (tone: ToastTone, title: string, message: string) => void;
}): JSX.Element {
  const { client, runs, setRuns, decisions, setDecisions, busy, setBusy, triggerResult, setTriggerResult, toast } = props;
  const [selectedRunId, setSelectedRunId] = useState<string | undefined>(undefined);

  const refreshRuns = async () => {
    const result = await client.getApifyCrawlRuns(20);
    if (result.ok && result.data) setRuns(readArray(result.data, "runs"));
  };

  const refreshDecisions = async (runId?: string) => {
    const result = await client.getApifyCurationDecisions(runId, 50);
    if (result.ok && result.data) setDecisions(readArray(result.data, "decisions"));
  };

  const triggerCuration = async () => {
    setBusy(true);
    setTriggerResult(undefined);
    try {
      const result = await client.triggerApifyCuration();
      if (result.ok && result.data) {
        setTriggerResult(result.data);
        toast("success", "Curation triggered", `Selected: ${readNumber(result.data, "selectedCount") ?? 0}, Enqueued: ${readNumber(result.data, "enqueuedCount") ?? 0}`);
        await refreshRuns();
      } else {
        toast("danger", "Curation failed", !result.ok && "message" in result ? (result as any).message : "Unknown error");
      }
    } catch (e) {
      toast("danger", "Curation error", String(e));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => { void refreshRuns(); }, []);

  useEffect(() => {
    if (selectedRunId) void refreshDecisions(selectedRunId);
  }, [selectedRunId]);

  return <div className="page-grid">
    <Card className="hero-card">
      <CardHeader eyebrow="Apify + Claude Pipeline" title="Autonomous Curation" description="Fetch social posts from Apify, rank with Claude, and publish to Telegram automatically." />
      <div className="stats-grid compact">
        <StatCard label="Total runs" value={String(runs.length)} tone="info" />
        <StatCard label="Last status" value={readString(runs[0], "status") ?? "—"} tone={statusTone(readString(runs[0], "status"))} />
        <StatCard label="Last selected" value={String(readNumber(runs[0], "claude_selected_count") ?? 0)} tone="success" />
        <StatCard label="Last enqueued" value={String(readNumber(runs[0], "items_queued_count") ?? 0)} tone="info" />
      </div>
      <div className="button-row">
        <Button variant="default" onClick={() => void triggerCuration()} disabled={busy}>
          {busy ? "Running…" : "Trigger Curation Now"}
        </Button>
        <Button variant="secondary" onClick={() => void refreshRuns()} disabled={busy}>Refresh</Button>
      </div>
      {triggerResult && <pre style={{ marginTop: "1rem", fontSize: "0.8rem", maxHeight: "300px", overflow: "auto" }}>{JSON.stringify(triggerResult, null, 2)}</pre>}
    </Card>

    <Card>
      <CardHeader eyebrow="History" title="Crawl Runs" />
      {runs.length === 0 ? <Alert title="No runs yet" tone="info">No Apify curation runs found. Trigger one manually or wait for the scheduled cron.</Alert> : <DataTable columns={[{ key: "id", label: "ID" }, { key: "status", label: "Status" }, { key: "items", label: "Items" }, { key: "selected", label: "Selected" }, { key: "enqueued", label: "Enqueued" }, { key: "dedupe", label: "Dedupe" }, { key: "timeMs", label: "Time (ms)" }, { key: "created", label: "Created" }]} rows={runs.map((run) => ({
        id: (readString(run, "id") ?? "").slice(0, 20),
        status: readString(run, "status") ?? "—",
        items: String(readNumber(run, "total_items") ?? 0),
        selected: String(readNumber(run, "claude_selected_count") ?? 0),
        enqueued: String(readNumber(run, "items_queued_count") ?? 0),
        dedupe: String(readNumber(run, "items_dedupe_count") ?? 0),
        timeMs: String(readNumber(run, "processing_time_ms") ?? "—"),
        created: readString(run, "created_at") ?? "—"
      }))} />}
    </Card>

    {selectedRunId && <Card>
      <CardHeader eyebrow={`Run: ${selectedRunId.slice(0, 25)}…`} title="Claude Decisions" />
      <div className="button-row"><Button variant="secondary" onClick={() => setSelectedRunId(undefined)}>Close</Button></div>
      {decisions.length === 0 ? <Alert title="No decisions" tone="info">No decisions found for this run.</Alert> : <DataTable columns={[{ key: "url", label: "URL" }, { key: "platform", label: "Platform" }, { key: "score", label: "Score" }, { key: "selected", label: "Selected" }, { key: "reason", label: "Reason" }, { key: "dedupe", label: "Dedupe" }]} rows={decisions.map((d) => ({
        url: readString(d, "source_url") ?? "—",
        platform: readString(d, "platform") ?? "—",
        score: String(readNumber(d, "claude_score") ?? 0),
        selected: readNumber(d, "selected") === 1 ? "Yes" : "No",
        reason: (readString(d, "claude_reason") ?? "—").slice(0, 80),
        dedupe: readString(d, "dedupe_status") ?? "—"
      }))} />}
    </Card>}
  </div>;
}
