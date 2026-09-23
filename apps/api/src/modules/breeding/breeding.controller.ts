import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from "@nestjs/common";
import {
  BreedRequest,
  type BreedingEventDto,
  type BreedingPreviewDto,
  type PedigreeNodeDto,
  type StudDto,
  StudOfferRequest,
} from "@thoroughline/contracts";
import { type AuthUser, CurrentUser } from "../../common/auth.js";
import { parse } from "../../common/http.js";
import { BreedingService } from "./breeding.service.js";

@Controller("breeding")
export class BreedingController {
  constructor(private readonly breeding: BreedingService) {}

  @Get("studs")
  studs(@CurrentUser() user: AuthUser): Promise<StudDto[]> {
    return this.breeding.studs(user.id);
  }

  @Post("studs")
  offer(@CurrentUser() user: AuthUser, @Body() body: unknown): Promise<StudDto> {
    const b = parse(StudOfferRequest, body);
    return this.breeding.offerStud(user.id, b.horseId, b.fee);
  }

  @Delete("studs/:horseId")
  @HttpCode(204)
  async withdraw(
    @CurrentUser() user: AuthUser,
    @Param("horseId", ParseUUIDPipe) horseId: string,
  ): Promise<void> {
    await this.breeding.withdrawStud(user.id, horseId);
  }

  @Get("preview")
  preview(@CurrentUser() user: AuthUser, @Query() query: unknown): Promise<BreedingPreviewDto> {
    const q = parse(BreedRequest, query);
    return this.breeding.preview(user.id, q.sireId, q.damId);
  }

  @Post()
  cover(@CurrentUser() user: AuthUser, @Body() body: unknown): Promise<BreedingEventDto> {
    const b = parse(BreedRequest, body);
    return this.breeding.cover(user.id, b.sireId, b.damId);
  }

  @Get("mine")
  mine(@CurrentUser() user: AuthUser): Promise<BreedingEventDto[]> {
    return this.breeding.mine(user.id);
  }

  @Get("pedigree/:horseId")
  pedigree(@Param("horseId", ParseUUIDPipe) horseId: string): Promise<PedigreeNodeDto> {
    return this.breeding.pedigree(horseId);
  }
}
