import { describe, expect, it } from "vitest";
import { buildWizardSteps, containsDangerousTestControl, deriveOverviewCards, hasRawConfigInDefaultSettings, nextRecommendedAction, safeSecretInputValue, SAFE_TESTS, summarizeWorkerConnection, technicalAreas, topLevelNavigationLabels } from "./dashboard-ux";
import type { StatusBundle } from "./types";

const connectedBundle: StatusBundle = {
  health: { ok: true, status: 200, data: { ok: true } },
  status: { ok: true, status: 200, data: { ok: true } },
  ready: { ok: true, status: 200, data: { ok: true } }
};

describe("dashboard operator UX rules", () => {
  it("uses only the six approved top-level sections", () => {
    expect(topLevelNavigationLabels()).toEqual(["Overview", "Setup Wizard", "Settings", "Diagnostics", "Tests", "Activity", "Technical"]);
  });

  it("keeps setup wizard inline with visible progress states", () => {
    const steps = buildWizardSteps({ workerReachable: true, hasAdminAccess: true, operatingMode: "manual_only", aiReady: false, telegramReady: false, wordpressReady: false, providersReady: false });
    expect(steps.map((step) => step.title)).toEqual(["Connect Worker", "Secure Admin Actions", "Choose Operating Mode", "Configure AI", "Configure Telegram Review & Routes", "Configure WordPress Drafts", "Optional Providers", "Run Safe Tests", "Launch Readiness"]);
    expect(steps.find((step) => step.id === "providers")).toMatchObject({ state: "optional", optional: true, action: "Skip providers" });
    expect(steps.some((step) => step.action === "Open")).toBe(false);
  });

  it("marks providers optional in manual-only mode", () => {
    const cards = deriveOverviewCards({ workerReachable: true, hasAdminAccess: true, operatingMode: "manual_only", aiProvider: "mock", telegramReady: false, wordpressReady: false, providersOptional: true, schedulerSafe: true, publishingSafe: true });
    expect(cards.find((card) => card.title === "Providers")).toMatchObject({ label: "Optional", explanation: "Provider setup is optional in Manual-only mode." });
  });

  it("shows a next recommended action on overview", () => {
    const cards = deriveOverviewCards({ workerReachable: true, hasAdminAccess: true, operatingMode: "manual_only", aiProvider: "mock", telegramReady: false, wordpressReady: false, providersOptional: true, schedulerSafe: true, publishingSafe: true });
    expect(nextRecommendedAction(cards)).toContain("Next:");
  });

  it("does not render raw config in default settings sections", () => {
    expect(hasRawConfigInDefaultSettings("settings")).toBe(false);
    expect(hasRawConfigInDefaultSettings("technical")).toBe(true);
  });

  it("never pre-fills secret inputs", () => {
    expect(safeSecretInputValue("stored-runtime-value")).toBe("");
    expect(safeSecretInputValue(undefined)).toBe("");
  });

  it("contains safe tests only", () => {
    const labels = SAFE_TESTS.map((test) => test.title);
    expect(labels).toEqual(["Readiness check", "Mock E2E pipeline", "AI sample generation", "Telegram route config", "Telegram publish queue dry-run", "Telegram review dry-run", "WordPress draft dry-run"]);
    expect(containsDangerousTestControl(labels)).toBe(false);
  });

  it("keeps raw and debug details in Technical", () => {
    expect(technicalAreas()).toEqual(expect.arrayContaining(["Raw /status", "Raw /ready", "Raw admin config", "CORS/debug info", "Raw test output"]));
  });

  it("keeps worker connected state visible after check", () => {
    expect(summarizeWorkerConnection(connectedBundle)).toBe("connected");
    expect(summarizeWorkerConnection({ ...connectedBundle, ready: { ok: false, status: 503, error: "not_ready", message: "Not ready" } })).toBe("reachable_not_ready");
  });
});
