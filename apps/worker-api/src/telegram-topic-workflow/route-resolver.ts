import { TelegramRoutesRepository, type TelegramRouteWithOutputs } from "@curator/db";
import type { ParsedManualTelegramMessage } from "@curator/telegram";
import type { Env } from "../types";

export type TelegramTopicRouteResolution =
  | { ok: true; routeWithOutputs: TelegramRouteWithOutputs }
  | { ok: false; reason: "missing_thread_id" | "unconfigured_telegram_topic" | "route_has_no_enabled_outputs" | "route_store_unavailable" };

export async function resolveTelegramTopicRoute(env: Env, parsed: ParsedManualTelegramMessage): Promise<TelegramTopicRouteResolution> {
  if (parsed.threadId === undefined) {
    return { ok: false, reason: "missing_thread_id" };
  }

  const repository = new TelegramRoutesRepository(env.DB);
  try {
    const routeWithOutputs = await repository.findEnabledRouteForSource(parsed.chatId, parsed.threadId);
    if (!routeWithOutputs) {
      return { ok: false, reason: "unconfigured_telegram_topic" };
    }
    if (routeWithOutputs.outputs.length === 0) {
      return { ok: false, reason: "route_has_no_enabled_outputs" };
    }
    return { ok: true, routeWithOutputs };
  } catch {
    return { ok: false, reason: "route_store_unavailable" };
  }
}
