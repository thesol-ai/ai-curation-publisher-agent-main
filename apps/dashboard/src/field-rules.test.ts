import { describe, expect, it } from "vitest";
import { AI_PROVIDER_OPTIONS, fieldHelpText, friendlyFieldLabel, GEMINI_MODEL_PRESETS, isCredentialKey, OPENAI_MODEL_PRESETS, saveButtonLabel, stepStateClass, stepStateLabel } from "./field-rules";

describe("dashboard field rules", () => {
  it("renders AI provider as a normal select-style setting", () => {
    expect(AI_PROVIDER_OPTIONS.map((option) => option.value)).toEqual(["mock", "gemini", "openai", "custom"]);
    expect(isCredentialKey("AI_PROVIDER")).toBe(false);
    expect(saveButtonLabel("AI_PROVIDER")).toBe("Save setting");
    expect(friendlyFieldLabel("AI_PROVIDER", "fallback")).toBe("AI provider");
  });

  it("keeps AI model presets and custom support available", () => {
    expect(GEMINI_MODEL_PRESETS).toEqual(["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.5-flash-lite"]);
    expect(OPENAI_MODEL_PRESETS).toEqual(["gpt-5.5", "gpt-5.4", "gpt-5.4-mini", "gpt-5.4-nano"]);
    expect(fieldHelpText("AI_MODEL", "")).toContain("Provider chooses the company/service");
  });

  it("uses the replacement action only for credential-like keys", () => {
    expect(saveButtonLabel("SAMPLE_API_KEY")).toBe("Replace secret");
    expect(saveButtonLabel("SAMPLE_TOKEN")).toBe("Replace secret");
    expect(saveButtonLabel("AI_MODEL")).toBe("Save setting");
    expect(saveButtonLabel("WORDPRESS_BASE_URL")).toBe("Save setting");
  });

  it("uses distinct wizard rail state classes and labels", () => {
    expect(stepStateClass("complete", false)).toBe("step-complete");
    expect(stepStateClass("needs_action", false)).toBe("step-needs-action");
    expect(stepStateClass("optional", false)).toBe("step-optional");
    expect(stepStateClass("locked", false)).toBe("step-locked");
    expect(stepStateClass("complete", true)).toBe("step-active");
    expect(stepStateLabel("complete", false, false)).toBe("Complete");
    expect(stepStateLabel("needs_action", false, false)).toBe("Needs action");
    expect(stepStateLabel("locked", false, false)).toBe("Locked");
    expect(stepStateLabel("complete", false, true)).toBe("Active");
  });

  it("adds direct helper copy for important setup fields", () => {
    expect(fieldHelpText("AI_PROVIDER", "")).toContain("Choose Mock for setup");
    expect(fieldHelpText("AI_MODEL_FALLBACKS", "")).toContain("separated by commas");
    expect(fieldHelpText("TELEGRAM_REVIEW_CHAT_ID", "")).toContain("review messages should go");
    expect(fieldHelpText("WORDPRESS_DEFAULT_STATUS", "")).toContain("draft");
  });
});
