import { describe, expect, it } from "vitest";
import { buildWizardGuidance } from "./wizard-content";
import type { TelegramRouteManagerSummary } from "./telegram-route-manager";

const emptyTelegramSummary: TelegramRouteManagerSummary = {
  botStatus: "Missing",
  finalPublishing: "Disabled",
  routeCount: 0,
  enabledOutputCount: 0,
  mediaMode: "telegram_file_id_reuse",
  wordpress: "Optional",
  routeCards: []
};

function textFor(id: Parameters<typeof buildWizardGuidance>[0]["id"]): string {
  const guidance = buildWizardGuidance({
    id,
    workerReachable: true,
    hasAdminAccess: true,
    operatingMode: "manual_only",
    aiProvider: "mock",
    wordpressReady: false,
    routeManagerSummary: emptyTelegramSummary
  });
  return JSON.stringify(guidance);
}

describe("wizard guidance content", () => {
  it("keeps Configure AI useful and non-generic", () => {
    const text = textFor("ai");
    expect(text).toContain("Mock is the safe setup mode");
    expect(text).toContain("Gemini");
    expect(text).toContain("gemini-2.5-flash");
    expect(text).toContain("OpenAI");
    expect(text).toContain("Provider, model, and API key are configured in Settings");
    expect(text).not.toContain("Use Settings for this step, then run safe tests. Public publishing controls are not available here.");
  });

  it("keeps Telegram wizard content focused on topics and routes", () => {
    const text = textFor("telegram");
    expect(text).toContain("source topic");
    expect(text).toContain("review topic");
    expect(text).toContain("Topic names are only for humans. The system uses numeric topic IDs.");
    expect(text).toContain("Use Settings → Telegram to load routes");
    expect(text).toContain("enter Admin access, click Load routes");
  });

  it("keeps launch readiness as a human checklist", () => {
    const text = textFor("readiness");
    expect(text).toContain("Worker connected");
    expect(text).toContain("Admin access active");
    expect(text).toContain("Operating mode selected");
    expect(text).toContain("AI configured or mock");
    expect(text).toContain("Telegram bot");
    expect(text).toContain("Routes configured");
    expect(text).toContain("WordPress optional");
    expect(text).toContain("Final publishing disabled/safe");
    expect(text).toContain("Media mode: telegram_file_id_reuse");
    expect(text).toContain("sendMediaGroup: supported for Telegram file_id albums with 2-10 safe media items");
  });

  it("does not add dangerous publishing controls", () => {
    const allText = ["connect", "admin", "mode", "ai", "telegram", "wordpress", "providers", "tests", "readiness"]
      .map((id) => textFor(id as Parameters<typeof buildWizardGuidance>[0]["id"]))
      .join(" ")
      .toLowerCase();
    expect(allText).not.toContain("enable final publish");
    expect(allText).not.toContain("enable public publish");
    expect(allText).not.toContain("enable scheduler publish");
  });
});
