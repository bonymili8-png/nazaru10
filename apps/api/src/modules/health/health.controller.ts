import { Controller, Get } from "@nestjs/common";
import { Public } from "../../common/auth.js";
import { Db } from "../../common/db.js";
import { AppError } from "../../common/errors.js";
import { SkipRateLimit } from "../../common/rate-limit.js";

@Controller()
@Public()
@SkipRateLimit()
export class HealthController {
  constructor(private readonly db: Db) {}

  /** Root: a friendly pointer instead of a 404 when someone opens the API address in a browser. */
  @Get()
  root() {
    return { service: "thoroughline-api", status: "ok", health: "/health", ready: "/ready" };
  }

  /** Liveness: the process is up. */
  @Get("health")
  health() {
    return { status: "ok" };
  }

  /** Readiness: dependencies reachable and schema migrated. */
  @Get("ready")
  async ready() {
    try {
      const r = await this.db.one<{ v: string }>("SELECT max(version) AS v FROM schema_migrations");
      return { status: "ready", schema: r?.v ?? null };
    } catch {
      throw new AppError(503, "NOT_READY", "Database unavailable");
    }
  }
}
