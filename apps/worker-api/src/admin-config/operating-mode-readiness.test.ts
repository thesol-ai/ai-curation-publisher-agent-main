import { describe, expect, it } from "vitest";
import { buildSafeConfigSummary, validateRuntimeConfig } from "../config";
import type { Env } from "../types";

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    DB: {} as D1Database,
    ENVIRONMENT: "production",
    INTERNAL_API_SECRET: "configured",
    TELEGRAM_REVIEW_CHAT_ID: "review-chat",
    TELEGRAM_FINAL_CHAT_ID: "final-chat",
    TELEGRAM_BOT_TOKEN: "configured",
    ...overrides
  };
}

describe("operating mode readiness", () => {
  it("does not require provider credentials in manual_only mode", () => {
    const summary = buildSafeConfigSummary(makeEnv({ OPERATING_MODE: "manual_only", PROVIDERS_MODE: "real" }));
    const validation = validateRuntimeConfig(makeEnv({ OPERATING_MODE: "manual_only", PROVIDERS_MODE: "real" }));

    expect(summary.operatingMode).toBe("manual_only");
    expect(summary.providerSetupRequired).toBe(false);
    expect(summary.providerSetupSatisfied).toBe(true);
    expect(validation.errors).not.toContain("Provider-assisted mode is selected but no provider credentials are configured.");
  });

  it("does not hard-fail manual_only production when review is not enabled", () => {
    const validation = validateRuntimeConfig(makeEnv({ OPERATING_MODE: "manual_only", TELEGRAM_REVIEW_CHAT_ID: "", TELEGRAM_FINAL_CHAT_ID: "", TELEGRAM_BOT_TOKEN: "", TELEGRAM_REAL_REVIEW_ENABLED: "false" }));

    expect(validation.ready).toBe(true);
    expect(validation.errors).toEqual([]);
    expect(validation.warnings.some((warning) => warning.includes("Telegram review configuration is incomplete"))).toBe(true);
  });

  it("hard-fails only when review workflow is enabled but incomplete", () => {
    const validation = validateRuntimeConfig(makeEnv({ OPERATING_MODE: "manual_only", TELEGRAM_REVIEW_CHAT_ID: "", TELEGRAM_FINAL_CHAT_ID: "", TELEGRAM_BOT_TOKEN: "", TELEGRAM_REAL_REVIEW_ENABLED: "true" }));

    expect(validation.ready).toBe(false);
    expect(validation.errors).toContain("Telegram review is enabled but review configuration is incomplete.");
  });

  it("guides provider credentials in provider_assisted mode", () => {
    const summary = buildSafeConfigSummary(makeEnv({ OPERATING_MODE: "provider_assisted", PROVIDERS_MODE: "real" }));
    const validation = validateRuntimeConfig(makeEnv({ OPERATING_MODE: "provider_assisted", PROVIDERS_MODE: "real" }));

    expect(summary.providerSetupRequired).toBe(true);
    expect(summary.providerSetupSatisfied).toBe(false);
    expect(validation.errors).toContain("Provider-assisted mode is selected but no provider credentials are configured.");
  });

  it("reports AI real provider missing credential and model", () => {
    const summary = buildSafeConfigSummary(makeEnv({ AI_PROVIDER: "openai", AI_MODEL: "" }));
    const validation = validateRuntimeConfig(makeEnv({ AI_PROVIDER: "openai", AI_MODEL: "" }));

    expect(summary.ai.provider).toBe("openai");
    expect(summary.ai.ready).toBe(false);
    expect(summary.ai.nextAction).toContain("Configure an AI model");
    expect(validation.errors.some((error) => error.includes("Configure an AI model"))).toBe(true);
  });

  it("accepts AI mock mode for demo while marking it non-production-grade", () => {
    const summary = buildSafeConfigSummary(makeEnv({ AI_PROVIDER: "mock" }));

    expect(summary.ai.ready).toBe(true);
    expect(summary.ai.productionGrade).toBe(false);
    expect(summary.ai.runtimeProviderSwitching).toBe("active_for_telegram_topic_outputs");
  });
});
