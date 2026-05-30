import type { PublishingQueuePayload } from "@curator/core";

export async function handlePublishingQueueMessage(payload: PublishingQueuePayload): Promise<void> {
  if (payload.queue !== "publishing") {
    throw new Error(`Unexpected queue payload: ${payload.queue}`);
  }

  console.log("Publishing queue stub received item", payload.itemId, "for", payload.target);
}
