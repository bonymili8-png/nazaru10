import { type CanActivate, type ExecutionContext, Inject, Injectable, SetMetadata } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { AuthedRequest } from "./auth.js";
import { ENV, type Env } from "../config/env.js";
import { tooMany } from "./errors.js";

const SKIP = "skipRateLimit";
const BUCKET = "rateBucket";
export const SkipRateLimit = () => SetMetadata(SKIP, true);
export type RateBucket = "auth" | "mutation" | "read";
export const RateLimit = (bucket: RateBucket) => SetMetadata(BUCKET, bucket);

const LIMITS: Record<RateBucket, { capacity: number; perMinute: number }> = {
  auth: { capacity: 10, perMinute: 10 },
  mutation: { capacity: 30, perMinute: 60 },
  read: { capacity: 120, perMinute: 300 },
};

/**
 * In-memory token bucket per (user or IP, bucket). Sufficient for a single node; swap for a
 * Redis implementation when running multiple API replicas.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly buckets = new Map<string, { tokens: number; at: number }>();
  private lastSweep = Date.now();

  constructor(
    private readonly reflector: Reflector,
    @Inject(ENV) private readonly env: Env,
  ) {}

  canActivate(ctx: ExecutionContext): boolean {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(SKIP, targets)) return true;
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const bucket =
      this.reflector.getAllAndOverride<RateBucket>(BUCKET, targets) ??
      (req.method === "GET" ? "read" : "mutation");
    const key = `${bucket}:${req.user?.id ?? `ip:${req.ip}`}`;
    const base = LIMITS[bucket];
    const scale = this.env.RATE_LIMIT_SCALE;
    const limit = scale === 1 ? base : { capacity: base.capacity * scale, perMinute: base.perMinute * scale };
    if (!this.take(key, limit)) throw tooMany();
    return true;
  }

  take(key: string, limit: { capacity: number; perMinute: number }, now = Date.now()): boolean {
    if (now - this.lastSweep > 60_000) this.sweep(now);
    const b = this.buckets.get(key) ?? { tokens: limit.capacity, at: now };
    b.tokens = Math.min(limit.capacity, b.tokens + ((now - b.at) / 60_000) * limit.perMinute);
    b.at = now;
    if (b.tokens < 1) {
      this.buckets.set(key, b);
      return false;
    }
    b.tokens -= 1;
    this.buckets.set(key, b);
    return true;
  }

  private sweep(now: number) {
    this.lastSweep = now;
    for (const [k, b] of this.buckets) if (now - b.at > 10 * 60_000) this.buckets.delete(k);
  }
}
