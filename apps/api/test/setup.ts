import "reflect-metadata";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgres://thoroughline:thoroughline@localhost:5432/thoroughline_test";
process.env.JWT_SECRET ??= "test-secret-test-secret-test-secret-123456";
process.env.RACE_SEED_SECRET ??= "test-race-seed-secret-test-race-seed-0000";
process.env.TELEGRAM_BOT_TOKEN ??= "123456:TEST-TOKEN-abcdefghijklmnopqrstuvwxyz";
process.env.TELEGRAM_WEBHOOK_SECRET ??= "test-webhook-secret-0123456789";
process.env.ALLOW_DEV_AUTH ??= "true";
process.env.JOB_RUNNER = "false";
process.env.LOG_LEVEL = "silent";
