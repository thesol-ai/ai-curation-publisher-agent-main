import type { Platform } from "@curator/core";

export type ProviderAvailabilityStatus =
  | "enabled"
  | "disabled"
  | "missing_credentials"
  | "misconfigured"
  | "healthy"
  | "unhealthy";

export type ProviderAvailability = {
  providerId: string;
  platform: Platform;
  status: ProviderAvailabilityStatus;
  enabled: boolean;
  credentialConfigured: boolean;
  message: string;
};

export class ProviderUnavailableError extends Error {
  readonly providerId: string;
  readonly status: ProviderAvailabilityStatus;

  constructor(providerId: string, status: ProviderAvailabilityStatus, message: string) {
    super(message);
    this.name = "ProviderUnavailableError";
    this.providerId = providerId;
    this.status = status;
  }
}

export function createProviderAvailability(input: {
  providerId: string;
  platform: Platform;
  enabled: boolean;
  credentialConfigured: boolean;
  missingCredentialName?: string;
}): ProviderAvailability {
  if (!input.enabled) {
    return {
      providerId: input.providerId,
      platform: input.platform,
      status: "disabled",
      enabled: false,
      credentialConfigured: input.credentialConfigured,
      message: "Provider is disabled by configuration."
    };
  }

  if (!input.credentialConfigured) {
    return {
      providerId: input.providerId,
      platform: input.platform,
      status: "missing_credentials",
      enabled: false,
      credentialConfigured: false,
      message: `Provider is enabled but missing ${input.missingCredentialName ?? "credentials"}.`
    };
  }

  return {
    providerId: input.providerId,
    platform: input.platform,
    status: "enabled",
    enabled: true,
    credentialConfigured: true,
    message: "Provider is configured. Real HTTP calls remain stubbed in this phase."
  };
}

export function assertProviderAvailable(availability: ProviderAvailability): void {
  if (!availability.enabled) {
    throw new ProviderUnavailableError(availability.providerId, availability.status, availability.message);
  }
}
