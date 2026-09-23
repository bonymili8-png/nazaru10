import { Injectable } from "@nestjs/common";

/** Injectable time source so time-dependent logic is testable. */
@Injectable()
export class Clock {
  private offsetMs = 0;
  now(): Date {
    return new Date(Date.now() + this.offsetMs);
  }
  /** Test helper: move time forward. */
  advance(ms: number): void {
    this.offsetMs += ms;
  }
}
