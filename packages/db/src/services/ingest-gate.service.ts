import { validateNormalizedPost } from "@curator/core";
import type { Item, ItemStatus, NormalizedPost, ValidationIssue } from "@curator/core";
import type { D1DatabaseLike } from "../client";
import { DedupeKeysRepository } from "../repositories/dedupe-keys.repository";
import { ItemsRepository } from "../repositories/items.repository";
import { DedupeService } from "./dedupe.service";
import { LifecycleService } from "./lifecycle.service";

export type IngestGateInput = {
  sourceId: string;
  post: NormalizedPost;
};

export type CostControlDecision = {
  entersAiQueue: boolean;
  entersMediaQueue: boolean;
  entersReviewQueue: boolean;
};

export type IngestGateResult =
  | {
      outcome: "queued";
      status: "queued_for_ai";
      validationIssues: [];
      costControl: CostControlDecision;
      item: Item;
    }
  | {
      outcome: "duplicate";
      status: "duplicate_skipped";
      validationIssues: [];
      costControl: CostControlDecision;
      existingItemId?: string;
    }
  | {
      outcome: "invalid";
      status: "invalid";
      validationIssues: ValidationIssue[];
      costControl: CostControlDecision;
    };

export class IngestGateService {
  private readonly dedupeService: DedupeService;
  private readonly itemsRepository: ItemsRepository;
  private readonly lifecycleService: LifecycleService;

  constructor(db: D1DatabaseLike) {
    this.itemsRepository = new ItemsRepository(db);
    this.dedupeService = new DedupeService(new DedupeKeysRepository(db));
    this.lifecycleService = new LifecycleService(this.itemsRepository);
  }

  async process(input: IngestGateInput): Promise<IngestGateResult> {
    const validation = validateNormalizedPost(input.post);
    const dedupe = await this.dedupeService.check(input.post);

    if (!validation.valid) {
      return {
        outcome: "invalid",
        status: "invalid",
        validationIssues: validation.issues,
        costControl: blockedCostControl()
      };
    }

    if (dedupe.duplicate) {
      return {
        outcome: "duplicate",
        status: "duplicate_skipped",
        validationIssues: [],
        costControl: blockedCostControl(),
        ...(dedupe.existingItemId === undefined ? {} : { existingItemId: dedupe.existingItemId })
      };
    }

    const item = await this.itemsRepository.createFromNormalizedPost({
      sourceId: input.sourceId,
      status: "discovered",
      post: input.post
    });

    await this.transitionItem(item.id, "discovered", "normalized");
    await this.transitionItem(item.id, "normalized", "validated");
    await this.transitionItem(item.id, "validated", "queued_for_ai");
    await this.dedupeService.recordItem(item.id, input.post);

    return {
      outcome: "queued",
      status: "queued_for_ai",
      validationIssues: [],
      costControl: {
        entersAiQueue: true,
        entersMediaQueue: false,
        entersReviewQueue: false
      },
      item: {
        ...item,
        status: "queued_for_ai"
      }
    };
  }

  private async transitionItem(itemId: string, from: ItemStatus, to: ItemStatus): Promise<void> {
    await this.lifecycleService.transitionItem(itemId, from, to);
  }
}

function blockedCostControl(): CostControlDecision {
  return {
    entersAiQueue: false,
    entersMediaQueue: false,
    entersReviewQueue: false
  };
}
