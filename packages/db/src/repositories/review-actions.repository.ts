import type { D1DatabaseLike } from "../client";

export type ReviewActionRecord = {
  id: string;
  item_id: string;
  reviewer_id: string;
  action: string;
  payload_json: string;
  created_at: string;
};

export type CreateReviewActionInput = {
  itemId: string;
  reviewerId: string;
  action: string;
  payload?: Record<string, unknown>;
};

export class ReviewActionsRepository {
  constructor(private readonly db: D1DatabaseLike) {}

  async createReviewAction(input: CreateReviewActionInput): Promise<ReviewActionRecord> {
    const now = new Date().toISOString();
    const record: ReviewActionRecord = {
      id: `review_action_${now.replace(/[^0-9]/g, "")}_${input.itemId}_${input.action}`,
      item_id: input.itemId,
      reviewer_id: input.reviewerId,
      action: input.action,
      payload_json: JSON.stringify(input.payload ?? {}),
      created_at: now
    };

    await this.db.prepare(
      "INSERT INTO review_actions (id, item_id, reviewer_id, action, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).bind(record.id, record.item_id, record.reviewer_id, record.action, record.payload_json, record.created_at).run();

    return record;
  }
}
