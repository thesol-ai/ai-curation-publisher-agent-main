import type { Platform, ProviderId, Source } from "@curator/core";
import type { ProviderAdapter, ProviderHealthStatus } from "./provider-adapter";

export type ProviderRegistryOptions = {
  defaultPriority?: Partial<Record<Platform, ProviderId[]>>;
};

export class ProviderRegistry {
  private readonly providers = new Map<string, ProviderAdapter>();
  private readonly defaultPriority: Partial<Record<Platform, ProviderId[]>>;

  constructor(options: ProviderRegistryOptions = {}) {
    this.defaultPriority = options.defaultPriority ?? {};
  }

  register(provider: ProviderAdapter): void {
    this.providers.set(provider.id, provider);
  }

  get(providerId: string): ProviderAdapter | undefined {
    return this.providers.get(providerId);
  }

  resolveProviderPriority(source: Source, providerPriorityOverride?: ProviderId[]): ProviderAdapter[] {
    const priority = providerPriorityOverride ?? source.providerPriority ?? this.defaultPriority[source.platform] ?? [];
    const providers: ProviderAdapter[] = [];

    for (const providerId of priority) {
      const provider = this.providers.get(providerId);
      if (provider && provider.platform === source.platform) {
        providers.push(provider);
      }
    }

    if (providers.length > 0) {
      return providers;
    }

    return Array.from(this.providers.values()).filter((provider) => provider.platform === source.platform);
  }

  async healthCheckAll(): Promise<ProviderHealthStatus[]> {
    return Promise.all(Array.from(this.providers.values()).map((provider) => provider.healthCheck()));
  }
}

export function createDefaultMockProviderPriority(): Record<Platform, ProviderId[]> {
  return {
    instagram: ["mock_instagram"],
    x: ["mock_x"],
    web: ["mock_web"],
    manual: []
  };
}
