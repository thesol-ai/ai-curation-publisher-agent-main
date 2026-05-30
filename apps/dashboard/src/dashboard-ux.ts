import type { ConnectionFeedback, StatusBundle } from "./types";

export type DashboardTab = "overview" | "setup" | "settings" | "diagnostics" | "tests" | "activity" | "technical";
export type WizardStepId = "connect" | "admin" | "mode" | "ai" | "telegram" | "wordpress" | "providers" | "tests" | "readiness";
export type WizardStepState = "active" | "complete" | "locked" | "optional" | "needs_action";
export type OperatorStatusLabel = "Connected" | "Missing" | "Optional" | "Safe" | "Warning" | "Not configured";
export type SafeTestId = "readiness" | "mock_e2e" | "ai_sample" | "telegram_review" | "telegram_route_config" | "telegram_publish_queue_dry_run" | "wordpress_draft";
export type WizardStep = { id: WizardStepId; title: string; state: WizardStepState; action: string; optional: boolean; detail?: string };
export type BuildWizardStepsInput = {
  workerReachable: boolean;
  hasAdminAccess: boolean;
  operatingMode: string;
  aiReady: boolean;
  telegramReady: boolean;
  wordpressReady: boolean;
  providersReady: boolean;
  routeCount?: number;
  outputCount?: number;
  finalPublishingEnabled?: boolean;
};

export const DASHBOARD_TABS: Array<{ id: DashboardTab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "setup", label: "Setup Wizard" },
  { id: "settings", label: "Settings" },
  { id: "diagnostics", label: "Diagnostics" },
  { id: "tests", label: "Tests" },
  { id: "activity", label: "Activity" },
  { id: "technical", label: "Technical" }
];

export const SAFE_TESTS: Array<{ id: SafeTestId; title: string; description: string; external: string; publishes: string; safety: "Safe" | "Needs confirmation" }> = [
  { id: "readiness", title: "Readiness check", description: "Checks whether the Worker is online and safe to continue.", external: "No external service calls.", publishes: "Publishes nothing.", safety: "Safe" },
  { id: "mock_e2e", title: "Mock E2E pipeline", description: "Runs the mock pipeline with test data only.", external: "No real providers.", publishes: "Publishes nothing.", safety: "Safe" },
  { id: "ai_sample", title: "AI sample generation", description: "Confirms AI setup status before real use.", external: "Only when a real AI provider is configured later.", publishes: "Publishes nothing.", safety: "Safe" },
  { id: "telegram_route_config", title: "Telegram route config", description: "Uses /status and /ready to confirm topic routes, enabled outputs, and final publishing safety.", external: "No Telegram API call.", publishes: "Publishes nothing.", safety: "Safe" },
  { id: "telegram_publish_queue_dry_run", title: "Telegram publish queue dry-run", description: "Review queue state and retry eligibility from Technical before using the protected retry API.", external: "No Telegram API call from this dashboard card.", publishes: "Publishes nothing.", safety: "Safe" },
  { id: "telegram_review", title: "Telegram review dry-run", description: "Sends or simulates a review message only when review is configured.", external: "May contact Telegram when enabled.", publishes: "No final Telegram publishing.", safety: "Needs confirmation" },
  { id: "wordpress_draft", title: "WordPress draft dry-run", description: "Creates or checks a draft-only WordPress flow.", external: "May contact WordPress when enabled.", publishes: "Draft only. No public publishing.", safety: "Needs confirmation" }
];

export function topLevelNavigationLabels(): string[] {
  return DASHBOARD_TABS.map((tab) => tab.label);
}

export function containsDangerousTestControl(labels: string[]): boolean {
  const normalized = labels.join(" ").toLowerCase();
  return normalized.includes("final publish") || normalized.includes("public publish") || normalized.includes("scheduler publish");
}

export function deriveOverviewCards(input: {
  workerReachable: boolean;
  hasAdminAccess: boolean;
  operatingMode: string;
  aiProvider: string;
  telegramReady: boolean;
  wordpressReady: boolean;
  providersOptional: boolean;
  schedulerSafe: boolean;
  publishingSafe: boolean;
}): Array<{ title: string; label: OperatorStatusLabel; explanation: string; nextAction: string }> {
  return [
    { title: "Worker connection", label: input.workerReachable ? "Connected" : "Missing", explanation: input.workerReachable ? "Worker is online." : "The dashboard has not reached the Worker yet.", nextAction: input.workerReachable ? "Continue setup." : "Open Setup Wizard and check connection." },
    { title: "Admin access", label: input.hasAdminAccess ? "Connected" : "Missing", explanation: input.hasAdminAccess ? "Admin actions are available for this page session." : "Admin actions need the internal admin secret.", nextAction: input.hasAdminAccess ? "Continue setup." : "Save admin access in Setup Wizard." },
    { title: "Operating mode", label: "Safe", explanation: modeCopy(input.operatingMode), nextAction: "Change mode in Settings if needed." },
    { title: "AI", label: input.aiProvider === "mock" ? "Warning" : "Connected", explanation: input.aiProvider === "mock" ? "Mock AI is active. Good for setup, not production-grade." : "AI provider is selected.", nextAction: input.aiProvider === "mock" ? "Configure AI when ready." : "Run a safe AI check." },
    { title: "Telegram review", label: input.telegramReady ? "Connected" : "Not configured", explanation: input.telegramReady ? "Review channel is configured. Topic route details are available in Technical." : "Telegram review or topic routes are not configured yet.", nextAction: input.telegramReady ? "Run review dry-run or inspect Telegram route config." : "Configure Telegram review and topic routes." },
    { title: "WordPress draft", label: input.wordpressReady ? "Connected" : "Not configured", explanation: input.wordpressReady ? "Draft setup is configured." : "WordPress draft setup is not configured yet.", nextAction: input.wordpressReady ? "Run draft dry-run." : "Configure WordPress drafts." },
    { title: "Providers", label: input.providersOptional ? "Optional" : "Missing", explanation: input.providersOptional ? "Provider setup is optional in Manual-only mode." : "Provider-assisted mode needs at least one provider.", nextAction: input.providersOptional ? "Skip for now." : "Configure one provider." },
    { title: "Scheduler safety", label: input.schedulerSafe ? "Safe" : "Warning", explanation: input.schedulerSafe ? "Scheduler automation is safe." : "Scheduler settings need review.", nextAction: input.schedulerSafe ? "No action needed." : "Check Technical details." },
    { title: "Publishing safety", label: input.publishingSafe ? "Safe" : "Warning", explanation: input.publishingSafe ? "Public publishing is disabled by default. Telegram final publishing requires an explicit server-side flag." : "Publishing safety needs review.", nextAction: input.publishingSafe ? "No action needed." : "Review safety before launch." }
  ];
}

export function nextRecommendedAction(cards: Array<{ title: string; label: OperatorStatusLabel; nextAction: string }>): string {
  const blocking = cards.find((card) => card.label === "Missing" || card.label === "Not configured" || card.label === "Warning");
  return blocking === undefined ? "Next: Run safe tests, then review launch readiness." : `Next: ${blocking.nextAction}`;
}

export function buildWizardSteps(input: BuildWizardStepsInput): WizardStep[] {
  const providersOptional = input.operatingMode === "manual_only" || input.operatingMode === "mock_demo";
  const telegramDetail = `Routes: ${input.routeCount ?? 0}. Outputs: ${input.outputCount ?? 0}. Final publishing: ${input.finalPublishingEnabled === true ? "Enabled" : "Disabled"}. WordPress is optional. Routing is based on Telegram chat ID and topic ID.`;

  return [
    { id: "connect", title: "Connect Worker", state: input.workerReachable ? "complete" : "active", action: "Check connection", optional: false },
    { id: "admin", title: "Secure Admin Actions", state: !input.workerReachable ? "locked" : input.hasAdminAccess ? "complete" : "active", action: "Save admin access", optional: false },
    { id: "mode", title: "Choose Operating Mode", state: input.workerReachable ? "complete" : "locked", action: "Save mode", optional: false },
    { id: "ai", title: "Configure AI", state: !input.workerReachable ? "locked" : input.aiReady ? "complete" : "needs_action", action: "Save AI settings", optional: false },
    { id: "telegram", title: "Configure Telegram Review & Routes", state: !input.workerReachable ? "locked" : input.telegramReady ? "complete" : "needs_action", action: "Review Telegram route status", optional: false, detail: telegramDetail },
    { id: "wordpress", title: "Configure WordPress Drafts", state: !input.workerReachable ? "locked" : input.wordpressReady ? "complete" : "needs_action", action: "Save WordPress settings", optional: false },
    { id: "providers", title: "Optional Providers", state: providersOptional ? "optional" : input.providersReady ? "complete" : "needs_action", action: providersOptional ? "Skip providers" : "Save provider settings", optional: providersOptional },
    { id: "tests", title: "Run Safe Tests", state: input.workerReachable ? "active" : "locked", action: "Run safe test", optional: false },
    { id: "readiness", title: "Launch Readiness", state: input.workerReachable ? "active" : "locked", action: "Review launch readiness", optional: false }
  ];
}

export function connectionTitle(feedback: ConnectionFeedback): string {
  return feedback.title;
}

export function modeCopy(mode: string): string {
  return mode === "manual_only" ? "Manual-only mode is active. Provider credentials are not required." : mode === "mock_demo" ? "Mock/demo mode is active for safe testing." : "Provider-assisted mode is active. Configure at least one provider.";
}

export function hasRawConfigInDefaultSettings(sectionId: string): boolean {
  return sectionId === "technical";
}

export function safeSecretInputValue(value: string | undefined): string {
  return value === undefined ? "" : "";
}

export function technicalAreas(): string[] {
  return ["Raw /status", "Raw /ready", "Telegram topic workflow routes", "Raw admin config", "CORS/debug info", "Raw test output"];
}

export function summarizeWorkerConnection(bundle: StatusBundle): "connected" | "reachable_not_ready" | "needs_connection" {
  if (bundle.health?.ok === true && bundle.status?.ok === true) return bundle.ready?.ok === true ? "connected" : "reachable_not_ready";
  return "needs_connection";
}
