export type ProviderErrorCategory =
  | "provider_disabled"
  | "missing_credentials"
  | "unsupported_source_type"
  | "rate_limited"
  | "timeout"
  | "network_error"
  | "http_error"
  | "invalid_response"
  | "provider_error"
  | "unknown_error";

export type ProviderErrorDetails = {
  category: ProviderErrorCategory;
  message: string;
  providerId?: string;
  statusCode?: number;
  cause?: unknown;
};

export class ProviderError extends Error {
  readonly category: ProviderErrorCategory;
  readonly providerId: string | undefined;
  readonly statusCode: number | undefined;
  readonly cause: unknown;

  constructor(details: ProviderErrorDetails) {
    super(details.message);
    this.name = "ProviderError";
    this.category = details.category;
    this.providerId = details.providerId;
    this.statusCode = details.statusCode;
    this.cause = details.cause;
  }
}

export function providerError(details: ProviderErrorDetails): ProviderError {
  return new ProviderError(details);
}

export function classifyProviderError(error: unknown): ProviderError {
  if (error instanceof ProviderError) {
    return error;
  }

  if (isProviderUnavailableLike(error)) {
    const status = error.status;
    return new ProviderError({
      category: status === "disabled" ? "provider_disabled" : status === "missing_credentials" ? "missing_credentials" : "provider_error",
      message: error.message,
      ...(error.providerId === undefined ? {} : { providerId: error.providerId }),
      cause: error
    });
  }

  if (error instanceof Error) {
    return new ProviderError({
      category: "unknown_error",
      message: error.message,
      cause: error
    });
  }

  return new ProviderError({
    category: "unknown_error",
    message: "Unknown provider error",
    cause: error
  });
}

function isProviderUnavailableLike(error: unknown): error is { message: string; providerId?: string; status?: string } {
  return typeof error === "object" && error !== null && "message" in error && "status" in error;
}
