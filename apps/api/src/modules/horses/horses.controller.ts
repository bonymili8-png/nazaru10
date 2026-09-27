import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import {
  type HorseAdviceDto,
  type HorseDetailDto,
  type HorseSummaryDto,
  SetFeedRequest,
  StartTrainingRequest,
  type TrainingSessionDto,
} from "@thoroughline/contracts";
import { type AuthUser, CurrentUser } from "../../common/auth.js";
import { Clock } from "../../common/clock.js";
import { Db } from "../../common/db.js";
import { forbidden } from "../../common/errors.js";
import { GameConfigService } from "../../common/game-config.js";
import { memberSql } from "../../common/membership.js";
import { parse } from "../../common/http.js";
import { RacesService } from "../races/races.service.js";
import { TrainingService } from "../training/training.service.js";
import { trainingAdvice } from "@thoroughline/engine";
import { getHorse, horsesByOwner } from "./horse.repo.js";
import { HorsesService } from "./horses.service.js";
import { NutritionService } from "./nutrition.service.js";

@Controller("horses")
export class HorsesController {
  constructor(
    private readonly db: Db,
    private readonly horses: HorsesService,
    private readonly nutrition: NutritionService,
    private readonly training: TrainingService,
    private readonly races: RacesService,
    private readonly clock: Clock,
    private readonly config: GameConfigService,
  ) {}

  @Get()
  async mine(@CurrentUser() user: AuthUser): Promise<HorseSummaryDto[]> {
    await this.training.settleDueForOwner(user.id);
    const now = this.clock.now();
    return (await horsesByOwner(this.db.pool, user.id)).map((h) => this.horses.summary(h, now));
  }

  @Get(":id")
  async detail(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<HorseDetailDto> {
    await this.training.settleDueForOwner(user.id);
    const h = await getHorse(this.db.pool, id);
    const mine = h.owner_id === user.id;
    const active = mine ? ((await this.training.active(this.db.pool, [h.id])).get(h.id) ?? null) : null;
    const listing = mine
      ? await this.db.one<{ id: string }>(
          "SELECT id FROM market_listings WHERE horse_id = $1 AND status = 'ACTIVE'",
          [h.id],
        )
      : null;
    const stud = mine
      ? await this.db.one<{ fee: number }>(
          "SELECT fee FROM studs WHERE horse_id = $1 AND active AND owner_id = $2",
          [h.id, user.id],
        )
      : null;
    return this.horses.detail(
      h,
      user.id,
      this.clock.now(),
      await this.horses.ownerName(h.owner_id),
      active,
      listing?.id ?? null,
      stud?.fee ?? null,
    );
  }

  /** Trainer's advice: rest, the next training session and open races that suit the horse. */
  @Get(":id/advice")
  async advice(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<HorseAdviceDto> {
    const h = await getHorse(this.db.pool, id);
    if (h.owner_id !== user.id) throw forbidden("You do not own this horse");
    const cfg = this.config.get();
    const training = trainingAdvice(h.attributes, h.genome.aptitudes, cfg);
    return {
      profile: training.profile,
      training: { type: training.type, attribute: training.attribute },
      restHours: this.horses.conditionDto(h, this.clock.now()).hoursToRaceReady,
      races: await this.races.suggestFor(h),
    };
  }

  /** Race record: the last 20 starts, or up to 100 for Owners' Circle members. */
  @Get(":id/races")
  async history(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    const m = await this.db.one<{ member: boolean }>(`SELECT ${memberSql("$1", "$2")} AS member`, [
      user.id,
      this.clock.now(),
    ]);
    const limit = m?.member ? 100 : 20;
    return (await this.races.horseHistory(id, limit)).map((r) => ({
      ...r,
      starts_at: r.starts_at.toISOString(),
    }));
  }

  @Get(":id/training")
  async trainingHistory(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<TrainingSessionDto[]> {
    const h = await getHorse(this.db.pool, id);
    if (h.owner_id !== user.id) return [];
    return this.training.history(id);
  }

  @Post(":id/training")
  train(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<TrainingSessionDto> {
    const req = parse(StartTrainingRequest, body);
    return this.training.start(user.id, id, req.type, req.intensity);
  }

  @Post(":id/vet")
  async vet(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string): Promise<HorseDetailDto> {
    const h = await this.horses.treat(user.id, id);
    return this.horses.detail(h, user.id, this.clock.now(), null, null);
  }

  @Post(":id/diagnostics")
  async diagnostics(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<HorseDetailDto> {
    const h = await this.horses.diagnose(user.id, id);
    return this.horses.detail(h, user.id, this.clock.now(), null, null);
  }

  /** Choose the horse's feed plan (weekly, credits; recovery only). */
  @Post(":id/feed")
  async feed(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<HorseDetailDto> {
    const req = parse(SetFeedRequest, body);
    const h = await this.nutrition.set(user.id, id, req.plan);
    return this.horses.detail(h, user.id, this.clock.now(), null, null);
  }
}
