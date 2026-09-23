import { buildApp } from "./app.js";
import { Db } from "./common/db.js";
import { createLogger } from "./common/logger.js";
import { loadEnv } from "./config/env.js";
import { migrateUp } from "./migrate/runner.js";
import { HttpBotApi } from "./modules/telegram/bot-api.js";

async function main() {
  const env = loadEnv();
  const logger = createLogger(env.LOG_LEVEL);
  const db = new Db(env.DATABASE_URL, env.DATABASE_POOL_MAX);
  const applied = await migrateUp(db.pool);
  if (applied.length) logger.info({ applied }, "migrations applied");
  const app = await buildApp({ env, logger, db, bot: new HttpBotApi(env.TELEGRAM_BOT_TOKEN, logger) });
  await app.listen({ port: env.PORT, host: "0.0.0.0" });
  logger.info({ port: env.PORT, jobs: env.JOB_RUNNER }, "api listening");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
