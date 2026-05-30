export type RateLimitDecision =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds?: number; reason: string };

export interface RateLimitGuard {
  check(request: Request): Promise<RateLimitDecision>;
}

export class NoopRateLimitGuard implements RateLimitGuard {
  async check(_request: Request): Promise<RateLimitDecision> {
    return { allowed: true };
  }
}

export class InMemoryRateLimitGuard implements RateLimitGuard {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();

  constructor(private readonly options: { limit: number; windowMs: number }) {}

  async check(request: Request): Promise<RateLimitDecision> {
    const key = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for") ?? "local";
    const now = Date.now();
    const current = this.hits.get(key);

    if (!current || current.resetAt <= now) {
      this.hits.set(key, { count: 1, resetAt: now + this.options.windowMs });
      return { allowed: true };
    }

    if (current.count >= this.options.limit) {
      return {
        allowed: false,
        retryAfterSeconds: Math.ceil((current.resetAt - now) / 1000),
        reason: "rate_limit_exceeded"
      };
    }

    current.count += 1;
    return { allowed: true };
  }
}
