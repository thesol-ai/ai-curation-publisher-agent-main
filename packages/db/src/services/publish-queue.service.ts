import type { OutputTarget } from "@curator/core";
import { ItemsRepository } from "../repositories/items.repository";
import { PublishQueueRepository, type PublishQueueRecord } from "../repositories/publish-queue.repository";

export type PublishScheduleSettings = {
  minMinutesBetweenPosts: number;
  allowedPublishHours: number[];
  timezone: string;
  maxPostsPerDay: number;
};

export type EnqueueApprovedItemResult = {
  queueItem: PublishQueueRecord;
  itemStatus: "queued_for_publish";
  alreadyQueued: boolean;
};

export type PublishabilityResult = {
  publishable: boolean;
  reason?: "outside_allowed_hours" | "daily_limit_reached";
};

export const DEFAULT_PUBLISH_SCHEDULE_SETTINGS: PublishScheduleSettings = {
  minMinutesBetweenPosts: 30,
  allowedPublishHours: [9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20],
  timezone: "UTC",
  maxPostsPerDay: 8
};

export class PublishQueueService {
  constructor(
    private readonly queueRepository: PublishQueueRepository,
    private readonly itemsRepository: ItemsRepository,
    private readonly settings: PublishScheduleSettings = DEFAULT_PUBLISH_SCHEDULE_SETTINGS
  ) {}

  async enqueueApprovedItem(itemId: string, target: OutputTarget = "telegram"): Promise<EnqueueApprovedItemResult> {
    const existing = await this.queueRepository.findExistingPendingOrScheduled(itemId, target);
    const queueItem = existing ?? await this.queueRepository.enqueue({ itemId, target });
    await this.itemsRepository.updateStatus(itemId, "queued_for_publish");

    return {
      queueItem,
      itemStatus: "queued_for_publish",
      alreadyQueued: existing !== null
    };
  }

  async getNextPublishableItem(target: OutputTarget, now: Date = new Date(), publishNow = false): Promise<PublishQueueRecord | null> {
    const nowIso = now.toISOString();
    const nextItem = await this.queueRepository.getNextPublishable(target, nowIso);
    if (!nextItem) {
      return null;
    }

    const publishability = await this.canPublishNow(target, now, publishNow);
    return publishability.publishable ? nextItem : null;
  }

  async markScheduled(queueItemId: string, scheduledFor: string): Promise<void> {
    await this.queueRepository.markScheduled(queueItemId, scheduledFor);
  }

  async markPublished(queueItemId: string, itemId: string, finalMessageId: string): Promise<void> {
    await this.queueRepository.markPublished(queueItemId, finalMessageId);
    await this.itemsRepository.updateStatus(itemId, "published_telegram");
  }

  async markFailed(queueItemId: string, errorMessage: string): Promise<void> {
    await this.queueRepository.markFailed(queueItemId, errorMessage);
  }

  async canPublishNow(target: OutputTarget, now: Date = new Date(), publishNow = false): Promise<PublishabilityResult> {
    if (publishNow) {
      return { publishable: true };
    }

    if (!this.settings.allowedPublishHours.includes(now.getUTCHours())) {
      return { publishable: false, reason: "outside_allowed_hours" };
    }

    const dayStart = new Date(now);
    dayStart.setUTCHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);
    const publishedToday = await this.queueRepository.countPublishedForDay(target, dayStart.toISOString(), dayEnd.toISOString());

    if (publishedToday >= this.settings.maxPostsPerDay) {
      return { publishable: false, reason: "daily_limit_reached" };
    }

    return { publishable: true };
  }
}
