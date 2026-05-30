import { describe, expect, it } from "vitest";
import { adminConfigGroupOrder, inputTypeForItem, initialDraftValue, safeConfiguredLabel } from "./admin-config-editor";
import type { AdminConfigItem } from "./types";

function makeItem(overrides: Partial<AdminConfigItem>): AdminConfigItem {
  return {
    key: "AI_PROVIDER",
    group: "ai",
    label: "AI Provider",
    description: "Provider used for generation.",
    whereUsed: "AI generation",
    type: "string",
    isSecret: false,
    editable: true,
    configured: true,
    source: "d1",
    value: "mock",
    safetyLevel: "safe",
    setupVisible: true,
    settingsVisible: true,
    requiredForProduction: false,
    optionalInManualOnly: true,
    restartRequired: false,
    validation: {},
    ...overrides
  };
}

describe("admin config editor helpers", () => {
  it("keeps all configuration groups available", () => {
    expect(adminConfigGroupOrder()).toEqual(["operating_mode", "content_input", "ai", "telegram", "wordpress", "providers", "scheduler", "quotas"]);
  });

  it("chooses editable control types from metadata", () => {
    expect(inputTypeForItem(makeItem({ validation: { enumValues: ["mock", "gemini"] } }))).toBe("select");
    expect(inputTypeForItem(makeItem({ type: "boolean" }))).toBe("checkbox");
    expect(inputTypeForItem(makeItem({ type: "integer" }))).toBe("number");
    expect(inputTypeForItem(makeItem({ type: "secret", isSecret: true }))).toBe("password");
    expect(inputTypeForItem(makeItem({ type: "url" }))).toBe("text");
  });

  it("never uses stored secret values as drafts", () => {
    expect(initialDraftValue(makeItem({ isSecret: true, value: "should-not-show", valueRedacted: "[configured]" }))).toBe("");
  });

  it("shows redacted secret status", () => {
    expect(safeConfiguredLabel(makeItem({ isSecret: true, configured: true, value: "secret" }))).toBe("Configured, value hidden");
    expect(safeConfiguredLabel(makeItem({ isSecret: true, configured: false }))).toBe("Missing");
  });
});
