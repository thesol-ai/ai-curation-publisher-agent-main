import type { ProcessingQueuePayload } from "@curator/core";

export async function handleProcessingQueueMessage(payload: ProcessingQueuePayload): Promise<void> {
  if (payload.queue !== "processing") {
    throw new Error(`Unexpected queue payload: ${payload.queue}`);
  }

  console.log("Processing queue stub received item", payload.itemId);
}
