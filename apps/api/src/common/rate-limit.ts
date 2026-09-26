import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  type OnModuleDestroy,
  SetMetadata,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Redis } from "ioredis";
import type { AuthedRequest } from "./auth.js";
import { ENV, type Env } from "../config/env.js";
import { tooMany } from "./errors.js";
import { LOGGER, type Logger } from "./logger.js";

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

export interface Limit {
  capacity: number;
  perMinute: number;
}

/** Token-bucket storage: returns true when a token was taken. */
export interface RateStore {
  take(key: string, limit: Limit): Promise<boolean>;
  close?(): Promise<void>;
}

const IDLE_MS = 10 * 60_000;

/** Per-process buckets: correct for one replica. */
export class MemoryRateStore implements RateStore {
  private readonly buckets = new Map<string, { tokens: number; at: number }>();
  private lastSweep = Date.now();

  async take(key: string, limit: Limit): Promise<boolean> {
    return this.takeAt(key, limit, Date.now());
  }

  takeAt(key: string, limit: Limit, now: number): boolean {
    if (now - this.lastSweep > 60_000) this.sweep(now);
    const b = this.buckets.get(key) ?? { tokens: limit.capacity, at: now };
    b.tokens = Math.min(limit.capacity, b.tokens + ((now - b.at) / 60_000) * limit.perMinute);
    b.at = now;
    const ok = b.tokens >= 1;
    if (ok) b.tokens -= 1;
    this.buckets.set(key, b);
    return ok;
  }

  private sweep(now: number) {
    this.lastSweep = now;
    for (const [k, b] of this.buckets) if (now - b.at > IDLE_MS) this.buckets.delete(k);
  }
}

/**
 * The same bucket kept in Redis, updated atomically by a script using Redis' own clock, so all
 * replicas share one budget per player/IP. Idle buckets expire.
 */
const TAKE = `
local cap = tonumber(ARGV[1])
local rate = tonumber(ARGV[2]) / 60000
local t = redis.call('TIME')
local now = t[1] * 1000 + math.floor(t[2] / 1000)
local b = redis.call('HMGET', KEYS[1], 'tokens', 'at')
local tokens = tonumber(b[1]) or cap
local at = tonumber(b[2]) or now
tokens = math.min(cap, tokens + math.max(0, now - at) * rate)
local ok = 0
if tokens >= 1 then
  tokens = tokens - 1
  ok = 1
end
redis.call('HSET', KEYS[1], 'tokens', tostring(tokens), 'at', tostring(now))
redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[3]))
return ok
`;

export class RedisRateStore implements RateStore {
  private readonly redis: Redis;

  constructor(
    url: string,
    private readonly fallback: RateStore,
    private readonly logger: Logger,
    private readonly prefix = "rl:",
  ) {
    // Wait briefly for (re)connection, then fall back rather than hold requests while Redis is away.
    this.redis = new Redis(url, { maxRetriesPerRequest: 1, commandTimeout: 250 });
    this.redis.on("error", (err) => this.logger.warn({ err }, "rate-limit redis error"));
  }

  async take(key: string, limit: Limit): Promise<boolean> {
    try {
      const ok = await this.redis.eval(TAKE, 1, this.prefix + key, limit.capacity, limit.perMinute, IDLE_MS);
      return ok === 1;
    } catch {
      // Redis down: keep limiting per replica rather than failing requests or letting all through.
      return this.fallback.take(key, limit);
    }
  }

  async close(): Promise<void> {
    await this.redis.quit().catch(() => undefined);
  }
}

export const createRateStore = (env: Env, logger: Logger): RateStore =>
  env.REDIS_URL ? new RedisRateStore(env.REDIS_URL, new MemoryRateStore(), logger) : new MemoryRateStore();

/** Token bucket per (user or IP, bucket). */
@Injectable()
export class RateLimitGuard implements CanActivate, OnModuleDestroy {
  readonly store: RateStore;

  constructor(
    private readonly reflector: Reflector,
    @Inject(ENV) private readonly env: Env,
    @Inject(LOGGER) logger: Logger,
  ) {
    this.store = createRateStore(env, logger);
  }

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
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
    if (!(await this.store.take(key, limit))) throw tooMany();
    return true;
  }

  async onModuleDestroy(): Promise<void> {
    await this.store.close?.();
  }
}
