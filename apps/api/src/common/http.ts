import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { ZodError, type z, type ZodTypeAny } from "zod";
import { AppError, badRequest } from "./errors.js";
import type { Logger } from "./logger.js";

/** Validate untrusted input against a zod schema; throws a 400 with issue details. */
export function parse<S extends ZodTypeAny>(schema: S, value: unknown): z.output<S> {
  const res = schema.safeParse(value);
  if (!res.success) {
    throw badRequest(
      "VALIDATION_ERROR",
      "Invalid request",
      res.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    );
  }
  return res.data;
}

const PG_CONFLICT: Record<string, { status: number; code: string; message: string }> = {
  "23505": { status: 409, code: "CONFLICT", message: "Resource already exists or is already in that state" },
  "23514": { status: 409, code: "CONSTRAINT_VIOLATION", message: "Operation violates a data constraint" },
  "23503": { status: 409, code: "REFERENCE_VIOLATION", message: "Referenced resource does not exist" },
  "22P02": { status: 400, code: "VALIDATION_ERROR", message: "Malformed identifier" },
};

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(private readonly logger: Logger) {}

  catch(err: unknown, host: ArgumentsHost): void {
    const reply = host.switchToHttp().getResponse<FastifyReply>();
    let status = 500;
    let body: { code: string; message: string; details?: unknown } = {
      code: "INTERNAL",
      message: "Internal error",
    };

    if (err instanceof AppError) {
      status = err.status;
      body = { code: err.code, message: err.message, details: err.details };
    } else if (err instanceof ZodError) {
      status = 400;
      body = { code: "VALIDATION_ERROR", message: "Invalid request", details: err.issues };
    } else if (err instanceof HttpException) {
      status = err.getStatus();
      body = { code: status === 404 ? "NOT_FOUND" : "HTTP_ERROR", message: err.message };
    } else if (
      typeof (err as { code?: unknown }).code === "string" &&
      PG_CONFLICT[(err as { code: string }).code]
    ) {
      const m = PG_CONFLICT[(err as { code: string }).code]!;
      status = m.status;
      body = { code: m.code, message: m.message };
      this.logger.warn({ err }, "database constraint rejected request");
    }
    if (status >= 500) this.logger.error({ err }, "unhandled error");
    void reply.status(status).send({ error: body });
  }
}
