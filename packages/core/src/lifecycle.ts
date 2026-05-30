export const ACTIVE_ITEM_STATUSES = [
  "discovered",
  "normalized",
  "validated",
  "queued_for_ai",
  "ai_processed",
  "media_ready",
  "sent_to_review",
  "approved",
  "queued_for_publish",
  "published_telegram",
  "published_wordpress",
  "archived"
] as const;

export const FAILURE_ITEM_STATUSES = [
  "duplicate_skipped",
  "invalid",
  "failed",
  "retry_pending",
  "cancelled"
] as const;

export const ITEM_STATUSES = [...ACTIVE_ITEM_STATUSES, ...FAILURE_ITEM_STATUSES] as const;
export type ItemStatus = typeof ITEM_STATUSES[number];

export const TERMINAL_ITEM_STATUSES = [
  "archived",
  "duplicate_skipped",
  "invalid",
  "cancelled"
] as const satisfies readonly ItemStatus[];

const TRANSITIONS: Record<ItemStatus, readonly ItemStatus[]> = {
  discovered: ["normalized", "duplicate_skipped", "invalid", "failed"],
  normalized: ["validated", "duplicate_skipped", "invalid", "failed"],
  validated: ["queued_for_ai", "failed", "cancelled"],
  queued_for_ai: ["ai_processed", "retry_pending", "failed", "cancelled"],
  ai_processed: ["media_ready", "sent_to_review", "failed", "cancelled"],
  media_ready: ["sent_to_review", "failed", "cancelled"],
  sent_to_review: ["approved", "cancelled", "retry_pending", "failed"],
  approved: ["queued_for_publish", "cancelled", "failed"],
  queued_for_publish: ["published_telegram", "retry_pending", "failed", "cancelled"],
  published_telegram: ["published_wordpress", "retry_pending", "failed"],
  published_wordpress: ["archived"],
  archived: [],
  duplicate_skipped: [],
  invalid: [],
  failed: ["retry_pending"],
  retry_pending: ["queued_for_ai", "queued_for_publish", "sent_to_review", "failed", "cancelled"],
  cancelled: []
};

export function isItemStatus(value: string): value is ItemStatus {
  return ITEM_STATUSES.includes(value as ItemStatus);
}

export function isTerminalItemStatus(status: ItemStatus): boolean {
  return TERMINAL_ITEM_STATUSES.includes(status as typeof TERMINAL_ITEM_STATUSES[number]);
}

export function canTransitionItemStatus(from: ItemStatus, to: ItemStatus): boolean {
  if (from === to) {
    return true;
  }

  return TRANSITIONS[from].includes(to);
}

export function assertItemStatusTransition(from: ItemStatus, to: ItemStatus): void {
  if (!canTransitionItemStatus(from, to)) {
    throw new Error(`Invalid item lifecycle transition: ${from} -> ${to}`);
  }
}

export function canEnterCostlyProcessing(status: ItemStatus): boolean {
  return status === "queued_for_ai";
}
