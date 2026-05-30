import { canTransitionItemStatus, type ItemStatus } from "@curator/core";
import { ItemsRepository } from "../repositories/items.repository";

export class LifecycleService {
  constructor(private readonly itemsRepository: ItemsRepository) {}

  async transitionItem(itemId: string, from: ItemStatus, to: ItemStatus): Promise<void> {
    if (!canTransitionItemStatus(from, to)) {
      throw new Error(`Invalid item lifecycle transition: ${from} -> ${to}`);
    }
    await this.itemsRepository.updateStatus(itemId, to);
  }
}
