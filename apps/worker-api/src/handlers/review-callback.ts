import { ItemsRepository, PublishQueueRepository, PublishQueueService, ReviewActionsRepository } from "@curator/db";
import type { D1DatabaseLike } from "@curator/db";
import type { ParsedTelegramCallback, TelegramReviewAction } from "@curator/telegram";

export type ReviewCallbackResult = {
  itemId: string;
  action: TelegramReviewAction;
  routed: true;
  resultingStatus: "sent_to_review" | "queued_for_publish" | "cancelled";
  publishQueueStatus?: "pending" | "scheduled" | "published" | "failed";
  publishQueueId?: string;
  statusResponse: {
    itemId: string;
    action: TelegramReviewAction;
    status: "sent_to_review" | "queued_for_publish" | "cancelled";
    publishStatus?: "pending" | "scheduled" | "published" | "failed";
    message: string;
    finalPublishingTriggered: false;
    editStubbed: boolean;
  };
};

export async function handleReviewCallback(parsed: ParsedTelegramCallback, db: D1DatabaseLike): Promise<ReviewCallbackResult> {
  const itemsRepository = new ItemsRepository(db);
  const reviewActionsRepository = new ReviewActionsRepository(db);
  const publishQueueService = new PublishQueueService(new PublishQueueRepository(db), itemsRepository);

  await reviewActionsRepository.createReviewAction({
    itemId: parsed.itemId,
    reviewerId: parsed.reviewerId,
    action: parsed.action,
    payload: {
      callbackId: parsed.callback.id,
      messageId: parsed.callback.message?.message_id,
      finalPublishingTriggered: false
    }
  });

  if (parsed.action === "send") {
    await itemsRepository.updateStatus(parsed.itemId, "approved");
    const enqueueResult = await publishQueueService.enqueueApprovedItem(parsed.itemId, "telegram");

    return {
      itemId: parsed.itemId,
      action: parsed.action,
      routed: true,
      resultingStatus: enqueueResult.itemStatus,
      publishQueueStatus: enqueueResult.queueItem.status,
      publishQueueId: enqueueResult.queueItem.id,
      statusResponse: {
        itemId: parsed.itemId,
        action: parsed.action,
        status: enqueueResult.itemStatus,
        publishStatus: enqueueResult.queueItem.status,
        message: createCallbackMessage(parsed.action),
        finalPublishingTriggered: false,
        editStubbed: false
      }
    };
  }

  if (parsed.action === "cancel") {
    await itemsRepository.updateStatus(parsed.itemId, "cancelled");
  }

  const resultingStatus = resolveResultingStatus(parsed.action);

  return {
    itemId: parsed.itemId,
    action: parsed.action,
    routed: true,
    resultingStatus,
    statusResponse: {
      itemId: parsed.itemId,
      action: parsed.action,
      status: resultingStatus,
      message: createCallbackMessage(parsed.action),
      finalPublishingTriggered: false,
      editStubbed: parsed.action === "edit"
    }
  };
}

function resolveResultingStatus(action: TelegramReviewAction): ReviewCallbackResult["resultingStatus"] {
  switch (action) {
    case "send":
      return "queued_for_publish";
    case "cancel":
      return "cancelled";
    case "edit":
    case "status":
      return "sent_to_review";
  }
}

function createCallbackMessage(action: TelegramReviewAction): string {
  switch (action) {
    case "edit":
      return "Edit action acknowledged. Editing remains stubbed for Phase 6.";
    case "send":
      return "Send action approved the item and queued it for publishing. Final publishing is not triggered by the callback.";
    case "cancel":
      return "Cancel action cancelled the item and did not enqueue publishing.";
    case "status":
      return "Status action returned current review and publishing routing state.";
  }
}
