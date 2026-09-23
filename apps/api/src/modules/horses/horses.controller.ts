import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import {
  type HorseDetailDto,
  type HorseSummaryDto,
  StartTrainingRequest,
  type TrainingSessionDto,
} from "@thoroughline/contracts";
import { type AuthUser, CurrentUser } from "../../common/auth.js";
import { Clock } from "../../common/clock.js";
import { Db } from "../../common/db.js";
import { parse } from "../../common/http.js";
import { RacesService } from "../races/races.service.js";
import { TrainingService } from "../training/training.service.js";
import { getHorse, horsesByOwner } from "./horse.repo.js";
import { HorsesService } from "./horses.service.js";

@Controller("horses")
export class HorsesController {
  constructor(
    private readonly db: Db,
    private readonly horses: HorsesService,
    private readonly training: TrainingService,
    private readonly races: RacesService,
    private readonly clock: Clock,
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
    return this.horses.detail(
      h,
      user.id,
      this.clock.now(),
      await this.horses.ownerName(h.owner_id),
      active,
      listing?.id ?? null,
    );
  }

  @Get(":id/races")
  async history(@Param("id", ParseUUIDPipe) id: string) {
    return (await this.races.horseHistory(id)).map((r) => ({ ...r, starts_at: r.starts_at.toISOString() }));
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
}
