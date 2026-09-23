import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { HireTrainerRequest, type StaffDto, type TrainerDto } from "@thoroughline/contracts";
import { type AuthUser, CurrentUser } from "../../common/auth.js";
import { parse } from "../../common/http.js";
import { StaffService } from "./staff.service.js";

@Controller("staff")
export class StaffController {
  constructor(private readonly staff: StaffService) {}

  @Get()
  mine(@CurrentUser() user: AuthUser): Promise<StaffDto> {
    return this.staff.mine(user.id);
  }

  @Get("trainers")
  available(): Promise<TrainerDto[]> {
    return this.staff.available();
  }

  @Post("contracts")
  hire(@CurrentUser() user: AuthUser, @Body() body: unknown): Promise<StaffDto> {
    return this.staff.hire(user.id, parse(HireTrainerRequest, body).trainerId);
  }

  @Delete("contracts/:id")
  dismiss(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string): Promise<StaffDto> {
    return this.staff.dismiss(user.id, id);
  }
}
