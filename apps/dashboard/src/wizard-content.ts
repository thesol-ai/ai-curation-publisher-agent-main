import type { WizardStepId } from "./dashboard-ux";
import type { TelegramRouteManagerSummary } from "./telegram-route-manager";

export type WizardGuidanceInput = {
  id: WizardStepId;
  workerReachable: boolean;
  hasAdminAccess: boolean;
  operatingMode: string;
  aiProvider: string;
  wordpressReady: boolean;
  routeManagerSummary: TelegramRouteManagerSummary;
};

export type WizardGuidance = {
  title: string;
  paragraphs: string[];
  bullets: string[];
  status: Array<{ label: string; value: string }>;
};

export function buildWizardGuidance(input: WizardGuidanceInput): WizardGuidance {
  switch (input.id) {
    case "connect":
      return {
        title: "Connect the dashboard to your Worker",
        paragraphs: [
          "Enter the deployed Worker URL, then use Check connection to confirm the dashboard can reach /health, /status, and /ready.",
          "Use the workers.dev URL for production or http://localhost:8787 for local development."
        ],
        bullets: [
          "Worker URL is stored locally in this browser.",
          "Connection state appears below the form.",
          "A connected Worker is required before setup checks are useful."
        ],
        status: [{ label: "Worker", value: input.workerReachable ? "Connected" : "Not connected yet" }]
      };
    case "admin":
      return {
        title: "Secure protected admin actions",
        paragraphs: [
          "Admin access lets this page call protected internal routes such as route validation, route loading, and safe dry-runs.",
          "Technical name: INTERNAL_API_SECRET. Enter it for this page session only; the dashboard must never show the secret value."
        ],
        bullets: [
          "Used only for this page session.",
          "Never paste the secret into docs, README, source code, or screenshots.",
          "If admin access is missing, Settings → Telegram cannot load protected route data."
        ],
        status: [{ label: "Admin access", value: input.hasAdminAccess ? "Active for this session" : "Missing" }]
      };
    case "mode":
      return {
        title: "Choose a safe operating mode",
        paragraphs: [
          `Current mode: ${input.operatingMode}.`,
          "Manual-only mode is safest for the first launch because providers are optional and nothing polls real sources automatically."
        ],
        bullets: [
          "Manual-only mode works with Telegram source topics.",
          "Firecrawl, Apify, and GetXAPI are optional in Manual-only mode.",
          "Provider-assisted mode can be configured later after the manual workflow is stable."
        ],
        status: [{ label: "Operating mode", value: input.operatingMode }]
      };
    case "ai":
      return {
        title: "Configure AI safely",
        paragraphs: [
          "Mock is the safe setup mode and is recommended for the first launch.",
          "Gemini is recommended for real AI testing when an API key exists; use gemini-2.5-flash for the first real test.",
          "OpenAI is available when its API key exists. Provider, model, and API key are configured in Settings."
        ],
        bullets: [
          "Recommended first launch: Mock.",
          "Recommended real test: Gemini + gemini-2.5-flash.",
          "AI appears configured when the provider is not mock, or mock is intentionally selected for setup."
        ],
        status: [
          { label: "Current AI provider", value: input.aiProvider },
          { label: "AI setup", value: input.aiProvider === "mock" ? "Safe mock mode" : "Configured for real testing" }
        ]
      };
    case "telegram":
      return {
        title: "Configure Telegram review and routes",
        paragraphs: [
          "A source topic is where source links or media enter the workflow. A review topic is where generated drafts wait for human approval.",
          "Topic names are only for humans. The system uses numeric topic IDs.",
          "Use Settings → Telegram to load routes, check route config, and inspect route cards."
        ],
        bullets: [
          "If no routes are loaded: enter Admin access, click Load routes, then seed or create a route if the count is still 0.",
          "Final channel delivery stays off by default and must be reviewed outside this dashboard.",
          "WordPress remains optional for this Telegram-first workflow."
        ],
        status: [
          { label: "Bot", value: input.routeManagerSummary.botStatus },
          { label: "Routes", value: String(input.routeManagerSummary.routeCount) },
          { label: "Enabled outputs", value: String(input.routeManagerSummary.enabledOutputCount) },
          { label: "Final publishing", value: input.routeManagerSummary.finalPublishing }
        ]
      };
    case "wordpress":
      return {
        title: "Configure WordPress drafts only when needed",
        paragraphs: [
          "WordPress is optional for the Telegram-first workflow.",
          "When configured, use draft-only checks first. WordPress live-site delivery remains off."
        ],
        bullets: [
          "Skip WordPress if Telegram is the only target for now.",
          "Use WordPress drafts only after credentials are configured safely.",
          "Keep WordPress live-site delivery off in this dashboard."
        ],
        status: [{ label: "WordPress", value: input.wordpressReady ? "Draft config detected" : "Optional / not configured" }]
      };
    case "providers":
      return {
        title: "Optional providers can wait",
        paragraphs: [
          "Firecrawl, Apify, and GetXAPI are not required for the manual Telegram workflow.",
          "In Manual-only mode, operators can paste or forward source content into Telegram source topics without provider automation."
        ],
        bullets: [
          "Skipped is acceptable in Manual-only mode.",
          "Add providers later when the route and review workflow is stable.",
          "Provider setup keeps automatic distribution off by default."
        ],
        status: [{ label: "Providers", value: input.operatingMode === "manual_only" ? "Optional / skipped" : "Needed for provider-assisted mode" }]
      };
    case "tests":
      return {
        title: "Run safe operational checks",
        paragraphs: [
          "Safe tests verify setup without live-site changes.",
          "Route config check validates route tables. Queue dry-run reviews queue status without sending to live channels."
        ],
        bullets: [
          "Readiness check: no external service calls.",
          "Telegram route config: no Telegram API call and nothing is sent.",
          "Telegram queue dry-run: no final channel message is sent.",
          "Telegram review dry-run requires confirmation and stays review-only."
        ],
        status: [{ label: "Live-channel controls", value: "Not available here" }]
      };
    case "readiness":
      return {
        title: "Human launch readiness checklist",
        paragraphs: ["Review each item before creating a PR or production rollout."],
        bullets: [
          `Worker connected: ${input.workerReachable ? "yes" : "no"}`,
          `Admin access active: ${input.hasAdminAccess ? "yes" : "no"}`,
          `Operating mode selected: ${input.operatingMode}`,
          `AI configured or mock: ${input.aiProvider === "mock" ? "mock" : "configured"}`,
          `Telegram bot: ${input.routeManagerSummary.botStatus}`,
          `Routes configured: ${input.routeManagerSummary.routeCount > 0 ? "yes" : "missing"}`,
          "WordPress optional: yes",
          `Final publishing disabled/safe: ${input.routeManagerSummary.finalPublishing === "Disabled" ? "yes" : "review required"}`,
          `Media mode: ${input.routeManagerSummary.mediaMode}`,
          "sendMediaGroup: supported for Telegram file_id albums with 2-10 safe media items"
        ],
        status: [{ label: "Readiness", value: input.workerReachable && input.hasAdminAccess ? "Review checklist" : "Needs setup" }]
      };
    default:
      return {
        title: "Setup guidance",
        paragraphs: ["Follow the step details before running safe tests."],
        bullets: [],
        status: []
      };
  }
}
