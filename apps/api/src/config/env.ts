import { z } from "zod";

const bool = z
  .enum(["true", "false", "1", "0"])
  .transform((v) => v === "true" || v === "1")
  .default("false");

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    DATABASE_URL: z.string().url(),
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(200).default(20),
    JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
    JWT_TTL_SEC: z.coerce
      .number()
      .int()
      .min(300)
      .max(7 * 86400)
      .default(12 * 3600),
    RACE_SEED_SECRET: z.string().min(32, "RACE_SEED_SECRET must be at least 32 characters"),
    TELEGRAM_BOT_TOKEN: z.string().default(""),
    TELEGRAM_WEBHOOK_SECRET: z.string().default(""),
    TELEGRAM_BOT_USERNAME: z.string().default(""),
    TELEGRAM_APP_SHORT_NAME: z.string().default(""),
    /** Shown by /paysupport and /terms: a Telegram @handle or an email address. */
    SUPPORT_CONTACT: z.string().max(100).default(""),
    /** Full terms of service / privacy policy pages, linked from /terms when set. */
    TERMS_URL: z.string().url().optional(),
    PRIVACY_URL: z.string().url().optional(),
    /** Public URL of the Mini App (used for the bot's "Open" button). */
    WEBAPP_URL: z.string().url().optional(),
    TELEGRAM_AUTH_MAX_AGE_SEC: z.coerce
      .number()
      .int()
      .min(60)
      .max(7 * 86400)
      .default(86400),
    ALLOW_DEV_AUTH: bool,
    CORS_ORIGINS: z.string().default(""),
    /**
     * Number of trusted reverse-proxy hops in front of the API (0 = none). Only trusted hops'
     * X-Forwarded-For entries are used for client IPs (rate limiting, audit).
     */
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
    /** Multiplies every rate-limit bucket (1 in production; raised for E2E runs from one IP). */
    RATE_LIMIT_SCALE: z.coerce.number().min(1).max(100).default(1),
    JOB_RUNNER: bool,
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== "production") return;
    if (env.ALLOW_DEV_AUTH)
      ctx.addIssue({
        code: "custom",
        path: ["ALLOW_DEV_AUTH"],
        message: "dev auth must be disabled in production",
      });
    for (const key of ["TELEGRAM_BOT_TOKEN", "TELEGRAM_WEBHOOK_SECRET"] as const) {
      if (env[key].length < 16)
        ctx.addIssue({ code: "custom", path: [key], message: "required in production" });
    }
    for (const key of ["JWT_SECRET", "RACE_SEED_SECRET"] as const) {
      if (/dev-only|change-me/i.test(env[key]))
        ctx.addIssue({ code: "custom", path: [key], message: "placeholder secret in production" });
    }
  });

export type Env = z.infer<typeof EnvSchema>;

/** Parse and validate the environment; the process refuses to start on invalid config. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment: ${issues}`);
  }
  return parsed.data;
}

export const ENV = Symbol("ENV");
