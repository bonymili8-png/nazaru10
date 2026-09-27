import { Controller, Get } from "@nestjs/common";
import type { LiveEventDto } from "@thoroughline/contracts";
import { LiveEventsService } from "./live-events.service.js";

@Controller("events")
export class EventsController {
  constructor(private readonly liveEvents: LiveEventsService) {}

  /** Live events running now or starting within a day (for the in-game banner). */
  @Get()
  current(): Promise<LiveEventDto[]> {
    return this.liveEvents.current();
  }
}
