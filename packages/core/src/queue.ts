export const QUEUE_NAMES = ["processing", "publishing", "media"] as const;
export type QueueName = typeof QUEUE_NAMES[number];

export type ProcessingQueuePayload = {
  queue: "processing";
  itemId: string;
  reason: "new_item" | "retry";
  attempt: number;
};

export type PublishingQueuePayload = {
  queue: "publishing";
  itemId: string;
  target: "telegram" | "wordpress";
  attempt: number;
  scheduledFor?: string;
};

export type MediaQueuePayload = {
  queue: "media";
  itemId: string;
  mediaAssetId: string;
  attempt: number;
};

export type QueuePayload = ProcessingQueuePayload | PublishingQueuePayload | MediaQueuePayload;
