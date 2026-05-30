import { TelegramGeneratedOutputsRepository, TelegramPublishQueueRepository, TelegramRoutesRepository } from "@curator/db";
import type { ParsedTelegramOutputCallback, TelegramClient } from "@curator/telegram";
import type { Env } from "../types";
import { decideTelegramPublishSchedule } from "./publish-scheduler";
import { publishTelegramQueueItem } from "./publish-runner";
import { refreshTelegramReviewMessageState } from "./review-message-state";
import { markTelegramReviewEditRequested } from "./review-edit-orchestrator";

export type TelegramOutputCallbackResult = {
  ok: boolean;
  kind: "output_callback";
  generatedOutputId: string;
  action: ParsedTelegramOutputCallback["action"];
  status?: string;
  publishQueueStatus?: string;
  scheduledFor?: string;
  message: string;
  finalPublishingTriggered: boolean;
};

type EnvWithFinalPublish = Env & { TELEGRAM_FINAL_PUBLISH_ENABLED?: string };

export async function handleTelegramOutputCallback(parsed: ParsedTelegramOutputCallback, env: Env, telegramClient?: TelegramClient): Promise<TelegramOutputCallbackResult> {
  const generatedOutputsRepository = new TelegramGeneratedOutputsRepository(env.DB);
  const publishQueueRepository = new TelegramPublishQueueRepository(env.DB);
  const routesRepository = new TelegramRoutesRepository(env.DB);
  const generatedOutput = await generatedOutputsRepository.findById(parsed.token);

  if (!generatedOutput) {
    await telegramClient?.answerCallbackQuery({ callbackQueryId: parsed.callback.id, text: "Output was not found." });
    return {
      ok: false,
      kind: "output_callback",
      generatedOutputId: parsed.token,
      action: parsed.action,
      message: "Telegram generated output was not found.",
      finalPublishingTriggered: false
    };
  }

  if (parsed.action === "edit") {
    const queueItem = await publishQueueRepository.findByGeneratedOutputId(generatedOutput.id);
    const locked = queueItem !== null;
    const editable = (generatedOutput.status === "generated" || generatedOutput.status === "ready_for_review" || generatedOutput.status === "failed") && !locked;
    const message = editable
      ? "Reply to this review message with the revised caption. Channel signatures are still applied automatically."
      : queueItem
        ? `This output already has a publish queue row (${queueItem.status}). Edit is only allowed before Send/Schedule creates a queue row.`
        : `This output cannot be edited while status is ${generatedOutput.status}.`;
    await telegramClient?.answerCallbackQuery({ callbackQueryId: parsed.callback.id, text: message });
    if (editable) await markTelegramReviewEditRequested({ env, generatedOutputId: generatedOutput.id, telegramClient });
    else await refreshTelegramReviewMessageState({ env, generatedOutputId: generatedOutput.id, telegramClient });
    return {
      ok: true,
      kind: "output_callback",
      generatedOutputId: generatedOutput.id,
      action: parsed.action,
      status: generatedOutput.status,
      ...(queueItem === null ? {} : { publishQueueStatus: queueItem.status }),
      message,
      finalPublishingTriggered: false
    };
  }

  if (parsed.action === "status") {
    const queueItem = await publishQueueRepository.findByGeneratedOutputId(generatedOutput.id);
    const message = queueItem
      ? `Status: ${generatedOutput.status}. Publish queue: ${queueItem.status}${queueItem.scheduledFor ? `. Scheduled for: ${queueItem.scheduledFor}` : ""}.`
      : `Status: ${generatedOutput.status}. Not queued for final publishing.`;
    await telegramClient?.answerCallbackQuery({ callbackQueryId: parsed.callback.id, text: message });
    await refreshTelegramReviewMessageState({ env, generatedOutputId: generatedOutput.id, telegramClient });
    return {
      ok: true,
      kind: "output_callback",
      generatedOutputId: generatedOutput.id,
      action: parsed.action,
      status: generatedOutput.status,
      ...(queueItem === null ? {} : { publishQueueStatus: queueItem.status }),
      ...(queueItem?.scheduledFor === undefined ? {} : { scheduledFor: queueItem.scheduledFor }),
      message,
      finalPublishingTriggered: false
    };
  }

  if (parsed.action === "cancel") {
    if (generatedOutput.status === "published" || generatedOutput.status === "cancelled") {
      const message = `Already ${generatedOutput.status}.`;
      await telegramClient?.answerCallbackQuery({ callbackQueryId: parsed.callback.id, text: message });
      await refreshTelegramReviewMessageState({ env, generatedOutputId: generatedOutput.id, telegramClient });
      return {
        ok: true,
        kind: "output_callback",
        generatedOutputId: generatedOutput.id,
        action: parsed.action,
        status: generatedOutput.status,
        message,
        finalPublishingTriggered: false
      };
    }

    await generatedOutputsRepository.updateStatus(generatedOutput.id, "cancelled");
    await telegramClient?.answerCallbackQuery({ callbackQueryId: parsed.callback.id, text: "Cancelled this output." });
    await refreshTelegramReviewMessageState({ env, generatedOutputId: generatedOutput.id, telegramClient });
    return {
      ok: true,
      kind: "output_callback",
      generatedOutputId: generatedOutput.id,
      action: parsed.action,
      status: "cancelled",
      message: "Cancelled this Telegram output only.",
      finalPublishingTriggered: false
    };
  }

  if (generatedOutput.status === "published" || generatedOutput.status === "cancelled") {
    const message = `Already ${generatedOutput.status}.`;
    await telegramClient?.answerCallbackQuery({ callbackQueryId: parsed.callback.id, text: message });
    await refreshTelegramReviewMessageState({ env, generatedOutputId: generatedOutput.id, telegramClient });
    return {
      ok: true,
      kind: "output_callback",
      generatedOutputId: generatedOutput.id,
      action: parsed.action,
      status: generatedOutput.status,
      message,
      finalPublishingTriggered: false
    };
  }

  const existingQueueItem = await publishQueueRepository.findByGeneratedOutputId(generatedOutput.id);
  if (existingQueueItem) {
    const message = existingQueueItem.status === "failed"
      ? "Already failed. Use the retry action after checking status."
      : `Already queued for Telegram publishing. Queue status: ${existingQueueItem.status}${existingQueueItem.scheduledFor ? `. Scheduled for: ${existingQueueItem.scheduledFor}` : ""}.`;
    await telegramClient?.answerCallbackQuery({ callbackQueryId: parsed.callback.id, text: message });
    await refreshTelegramReviewMessageState({ env, generatedOutputId: generatedOutput.id, telegramClient });
    return {
      ok: existingQueueItem.status !== "failed",
      kind: "output_callback",
      generatedOutputId: generatedOutput.id,
      action: parsed.action,
      status: generatedOutput.status,
      publishQueueStatus: existingQueueItem.status,
      ...(existingQueueItem.scheduledFor === undefined ? {} : { scheduledFor: existingQueueItem.scheduledFor }),
      message,
      finalPublishingTriggered: false
    };
  }

  const routeOutput = await routesRepository.findOutputById(generatedOutput.routeOutputId);
  if (!routeOutput) {
    await generatedOutputsRepository.updateStatus(generatedOutput.id, "failed", "Route output is missing.");
    await telegramClient?.answerCallbackQuery({ callbackQueryId: parsed.callback.id, text: "Route output is missing." });
    await refreshTelegramReviewMessageState({ env, generatedOutputId: generatedOutput.id, telegramClient });
    return {
      ok: false,
      kind: "output_callback",
      generatedOutputId: generatedOutput.id,
      action: parsed.action,
      status: "failed",
      message: "Route output is missing; cannot queue final publishing.",
      finalPublishingTriggered: false
    };
  }

  const scheduleRouteOutput = parsed.action === "schedule" ? { ...routeOutput, publishMode: "scheduled" as const } : routeOutput;
  const schedule = await decideTelegramPublishSchedule({ routeOutput: scheduleRouteOutput, queueRepository: publishQueueRepository });
  if (schedule.reason === "publish_disabled") {
    await generatedOutputsRepository.updateStatus(generatedOutput.id, "failed", "Publishing is disabled for this route output.");
    await telegramClient?.answerCallbackQuery({ callbackQueryId: parsed.callback.id, text: "Publishing is disabled for this output." });
    await refreshTelegramReviewMessageState({ env, generatedOutputId: generatedOutput.id, telegramClient });
    return {
      ok: false,
      kind: "output_callback",
      generatedOutputId: generatedOutput.id,
      action: parsed.action,
      status: "failed",
      message: "Publishing is disabled for this route output.",
      finalPublishingTriggered: false
    };
  }

  await generatedOutputsRepository.updateStatus(generatedOutput.id, "approved");
  const queueItem = await publishQueueRepository.enqueue({
    itemId: generatedOutput.itemId,
    generatedOutputId: generatedOutput.id,
    routeId: generatedOutput.routeId,
    routeOutputId: generatedOutput.routeOutputId,
    language: generatedOutput.language,
    finalChatId: routeOutput.finalChatId,
    ...(routeOutput.finalThreadId === undefined ? {} : { finalThreadId: routeOutput.finalThreadId }),
    ...(schedule.scheduledFor === undefined ? {} : { scheduledFor: schedule.scheduledFor }),
    priority: schedule.priority
  });

  const finalPublishingEnabled = isFinalPublishingEnabled(env);
  const scheduledInFuture = schedule.scheduledFor !== undefined && new Date(schedule.scheduledFor).getTime() > Date.now() + 5_000;
  const shouldPublishNow = finalPublishingEnabled && schedule.publishMode === "immediate" && !scheduledInFuture;

  if (!shouldPublishNow) {
    const nextStatus = schedule.scheduledFor === undefined ? "queued_for_publish" : "scheduled";
    await generatedOutputsRepository.updateStatus(generatedOutput.id, nextStatus);
    const text = finalPublishingEnabled
      ? schedule.scheduledFor === undefined ? "Queued for Telegram publishing." : `Scheduled for ${schedule.scheduledFor}.`
      : schedule.scheduledFor === undefined ? "Queued. Final Telegram publishing is disabled." : `Scheduled for ${schedule.scheduledFor}. Final Telegram publishing is disabled.`;
    await telegramClient?.answerCallbackQuery({ callbackQueryId: parsed.callback.id, text });
    await refreshTelegramReviewMessageState({ env, generatedOutputId: generatedOutput.id, telegramClient });
    return {
      ok: true,
      kind: "output_callback",
      generatedOutputId: generatedOutput.id,
      action: parsed.action,
      status: nextStatus,
      publishQueueStatus: queueItem.status,
      ...(schedule.scheduledFor === undefined ? {} : { scheduledFor: schedule.scheduledFor }),
      message: text,
      finalPublishingTriggered: false
    };
  }

  const publishResult = await publishTelegramQueueItem({ env, queueItem, callbackClient: telegramClient });
  if (publishResult.status === "skipped") {
    await generatedOutputsRepository.updateStatus(generatedOutput.id, queueItem.scheduledFor === undefined ? "queued_for_publish" : "scheduled");
  }
  await telegramClient?.answerCallbackQuery({ callbackQueryId: parsed.callback.id, text: publishResult.message });
  await refreshTelegramReviewMessageState({ env, generatedOutputId: generatedOutput.id, telegramClient });
  const callbackStatus = publishResult.status === "published" ? "published" : publishResult.status === "skipped" ? queueItem.status : "failed";
  return {
    ok: publishResult.ok,
    kind: "output_callback",
    generatedOutputId: generatedOutput.id,
    action: parsed.action,
    status: callbackStatus,
    publishQueueStatus: publishResult.status === "skipped" ? queueItem.status : publishResult.status,
    message: publishResult.message,
    finalPublishingTriggered: publishResult.status !== "skipped"
  };
}

function isFinalPublishingEnabled(env: Env): boolean {
  return (env as EnvWithFinalPublish).TELEGRAM_FINAL_PUBLISH_ENABLED === "true";
}
