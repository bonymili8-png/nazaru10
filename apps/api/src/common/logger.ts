import { type LoggerService } from "@nestjs/common";
import pino from "pino";

export const createLogger = (level: string) =>
  pino({ level, base: { service: "thoroughline-api" }, timestamp: pino.stdTimeFunctions.isoTime });

export type Logger = ReturnType<typeof createLogger>;

/** Adapts pino to Nest's LoggerService so framework logs are structured JSON too. */
export class NestPinoLogger implements LoggerService {
  constructor(private readonly logger: Logger) {}
  log(message: unknown, context?: string) {
    this.logger.info({ context }, String(message));
  }
  error(message: unknown, trace?: string, context?: string) {
    this.logger.error({ context, trace }, String(message));
  }
  warn(message: unknown, context?: string) {
    this.logger.warn({ context }, String(message));
  }
  debug(message: unknown, context?: string) {
    this.logger.debug({ context }, String(message));
  }
  verbose(message: unknown, context?: string) {
    this.logger.trace({ context }, String(message));
  }
}

export const LOGGER = Symbol("LOGGER");
