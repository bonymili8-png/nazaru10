import { Inject, Injectable, type OnApplicationBootstrap, type OnApplicationShutdown } from "@nestjs/common";
import { LOGGER, type Logger } from "../../common/logger.js";
import { ENV, type Env } from "../../config/env.js";
import { BreedingService } from "../breeding/breeding.service.js";
import { SeasonsService } from "../seasons/seasons.service.js";
import { StaffService } from "../staff/staff.service.js";
import { TournamentsService } from "../tournaments/tournaments.service.js";
import { MarketService } from "../market/market.service.js";
import { NotificationsService } from "../notifications/notifications.service.js";
import { RaceRunnerService } from "../races/race-runner.service.js";
import { ShopService } from "../shop/shop.service.js";
import { TrainingService } from "../training/training.service.js";

/**
 * Background sweeps. Each step claims work with row locks (FOR UPDATE SKIP LOCKED) and is
 * idempotent, so any number of worker processes can run this safely.
 */
@Injectable()
export class JobRunnerService implements OnApplicationBootstrap, OnApplicationShutdown {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private lastSlow = 0;

  constructor(
    private readonly races: RaceRunnerService,
    private readonly training: TrainingService,
    private readonly shop: ShopService,
    private readonly market: MarketService,
    private readonly breeding: BreedingService,
    private readonly seasons: SeasonsService,
    private readonly tournaments: TournamentsService,
    private readonly staff: StaffService,
    private readonly notifications: NotificationsService,
    @Inject(ENV) private readonly env: Env,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.env.JOB_RUNNER) return;
    this.timer = setInterval(() => void this.tick(), 2000);
    this.logger.info("job runner started");
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const now = Date.now();
      if (now - this.lastSlow > 30_000) {
        this.lastSlow = now;
        await this.step("schedule", () => this.races.scheduleAhead());
        await this.step("shop", () => this.shop.restock());
        await this.step("seasons", () => this.seasons.closeDue());
        await this.step("tournament-schedule", () => this.tournaments.scheduleAhead());
        await this.step("staff-pool", () => this.staff.restock());
        await this.step("jockey-pool", () => this.staff.restockJockeys());
        await this.step("staff-salaries", () => this.staff.renewDue());
      }
      await this.step("lock", () => this.races.lockDue());
      await this.step("run", () => this.races.runDue());
      await this.step("settle", () => this.races.settleDue());
      await this.step("tournaments", () => this.tournaments.advanceDue());
      await this.step("training", () => this.training.settleAllDue());
      await this.step("market", () => this.market.settleDue());
      await this.step("foals", () => this.breeding.deliverDue());
      await this.step("notify", () => this.notifications.processOutbox());
    } finally {
      this.running = false;
    }
  }

  private async step(name: string, fn: () => Promise<number>): Promise<void> {
    const started = Date.now();
    try {
      const n = await fn();
      if (n > 0) this.logger.info({ job: name, n, ms: Date.now() - started }, "job step");
    } catch (err) {
      this.logger.error({ err, job: name }, "job step failed");
    }
  }
}
