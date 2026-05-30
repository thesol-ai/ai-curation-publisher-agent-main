import { describe, expect, it } from "vitest";
import { buildTelegramRouteManagerSummary, summarizeRecentTelegramOutputs, telegramBotMissingText, telegramRouteManagerCopy, telegramRoutesEmptyStateText, telegramRoutesEmptyStateTitle, TELEGRAM_OUTPUT_FORM_FIELDS, TELEGRAM_ROUTE_FORM_FIELDS } from "./telegram-route-manager";

describe("telegram route manager UX helpers", () => {
  it("renders route summary without raw JSON", () => {
    const summary = buildTelegramRouteManagerSummary({
      botTokenConfigured: true,
      finalPublishingEnabled: false,
      routeCount: 1,
      enabledOutputCount: 1,
      mediaMode: "telegram_file_id_reuse",
      routes: [
        {
          id: "crypto",
          category: "crypto",
          sourceChatId: "-1001234567890",
          sourceThreadId: 101,
          promptProfile: "crypto_editorial",
          enabled: true,
          warnings: [],
          outputs: [
            {
              id: "crypto_fa",
              language: "fa",
              reviewChatId: "-1001234567890",
              reviewThreadId: 201,
              finalChatId: "@crypto_fa",
              enabled: true,
              latestStatus: "ready_for_review"
            }
          ]
        }
      ]
    });

    expect(summary).toMatchObject({
      botStatus: "Configured",
      finalPublishing: "Disabled",
      routeCount: 1,
      enabledOutputCount: 1,
      mediaMode: "telegram_file_id_reuse",
      wordpress: "Optional"
    });
    expect(summary.routeCards[0]).toMatchObject({
      title: "crypto",
      category: "crypto",
      sourceChatId: "-1001234567890",
      sourceThreadId: 101,
      promptProfile: "crypto_editorial",
      enabledLabel: "Enabled",
      outputsCount: 1
    });
    expect(JSON.stringify(summary)).not.toContain("TELEGRAM_BOT_TOKEN");
  });

  it("uses friendly route and output form labels", () => {
    expect(telegramRouteManagerCopy()).toBe("Topic names are only for humans. The system uses numeric topic IDs.");
    expect(TELEGRAM_ROUTE_FORM_FIELDS.map((field) => field.label)).toEqual(["Route ID", "Category", "Source chat ID", "Source topic ID", "Prompt profile", "Enabled"]);
    expect(TELEGRAM_OUTPUT_FORM_FIELDS.map((field) => field.label)).toEqual(["Output ID", "Language", "Review chat ID", "Review topic ID", "Final channel/chat ID", "Final topic ID", "Enabled", "Publish enabled", "Publish mode", "Timezone", "Allowed windows", "Minimum gap", "Max per hour", "Max per day", "Queue priority", "Channel signature", "Signature channel handle"]);
    expect(TELEGRAM_ROUTE_FORM_FIELDS.some((field) => field.helper.includes("-1001234567890"))).toBe(true);
    expect(TELEGRAM_ROUTE_FORM_FIELDS.some((field) => field.helper.includes("101"))).toBe(true);
    expect(TELEGRAM_OUTPUT_FORM_FIELDS.some((field) => field.helper.includes("@crypto_fa"))).toBe(true);
  });

  it("does not expose secrets in route manager form definitions", () => {
    expect(TELEGRAM_ROUTE_FORM_FIELDS.every((field) => field.secret === false)).toBe(true);
    expect(TELEGRAM_OUTPUT_FORM_FIELDS.every((field) => field.secret === false)).toBe(true);
    expect(JSON.stringify([...TELEGRAM_ROUTE_FORM_FIELDS, ...TELEGRAM_OUTPUT_FORM_FIELDS])).not.toContain("TOKEN");
  });

  it("shows final publishing state but does not casually enable it", () => {
    const disabled = buildTelegramRouteManagerSummary({ finalPublishingEnabled: false, routes: [] });
    const enabled = buildTelegramRouteManagerSummary({ finalPublishingEnabled: true, routes: [] });
    expect(disabled.finalPublishing).toBe("Disabled");
    expect(enabled.finalPublishing).toBe("Enabled");
    expect(JSON.stringify(disabled)).not.toContain("Enable final publish");
  });

  it("explains Telegram empty states with admin access and seed/create guidance", () => {
    const summary = buildTelegramRouteManagerSummary({ botTokenConfigured: true, routeCount: 0, enabledOutputCount: 0, routes: [] });
    expect(telegramRoutesEmptyStateTitle()).toBe("No routes loaded yet.");
    expect(telegramRoutesEmptyStateText(summary)).toContain("Enter Admin access, then click Load routes");
    expect(telegramRoutesEmptyStateText(summary)).toContain("create or seed a route first");
    expect(telegramRoutesEmptyStateText(summary)).toContain("A route connects one source topic to one or more review/final outputs.");
  });

  it("explains bot missing state without exposing a secret", () => {
    const summary = buildTelegramRouteManagerSummary({ botTokenConfigured: false, routes: [] });
    const message = telegramBotMissingText(summary);
    expect(message).toContain("TELEGRAM_BOT_TOKEN");
    expect(message).toContain("Cloudflare Worker Secret");
    expect(message).toContain("redeploy");
    expect(message).not.toContain("123456:");
  });

  it("redacts recent Telegram output errors", () => {
    const outputs = summarizeRecentTelegramOutputs([
      {
        itemId: "item_local",
        category: "crypto",
        language: "fa",
        reviewStatus: "failed",
        publishQueueStatus: "failed",
        finalChatId: "@crypto_fa",
        lastError: "Telegram failed with 123456:ABC_SECRET_TOKEN",
        updatedAt: "2026-05-25T00:00:00.000Z"
      }
    ]);
    expect(outputs[0]).toMatchObject({
      itemId: "item_local",
      category: "crypto",
      language: "fa",
      reviewStatus: "failed",
      publishQueueStatus: "failed",
      finalChatId: "@crypto_fa",
      lastError: "Telegram failed with [redacted-token]"
    });
  });
});
