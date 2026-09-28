import "reflect-metadata";
import { constants as zlib } from "node:zlib";
import compress from "@fastify/compress";
import cors from "@fastify/cors";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { type AppDeps, AppModule } from "./app.module.js";
import { AllExceptionsFilter } from "./common/http.js";
import { NestPinoLogger } from "./common/logger.js";

export async function buildApp(deps: AppDeps): Promise<NestFastifyApplication> {
  const adapter = new FastifyAdapter({
    bodyLimit: 64 * 1024,
    trustProxy: deps.env.TRUST_PROXY_HOPS > 0 ? deps.env.TRUST_PROXY_HOPS : false,
  });
  const app = await NestFactory.create<NestFastifyApplication>(AppModule.forRoot(deps), adapter, {
    logger: new NestPinoLogger(deps.logger),
    bufferLogs: false,
  });
  const origins = deps.env.CORS_ORIGINS.split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  await app.register(cors, {
    origin: origins.length ? origins : false,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    allowedHeaders: ["authorization", "content-type"],
    // Browsers cap preflight caching at 2 h; fewer OPTIONS round-trips before each call.
    maxAge: 7200,
  });
  // Race replays, lists and the admin console are JSON that compresses ~5–10×; brotli at a
  // low quality level is fast enough for per-request compression.
  await app.register(compress, {
    threshold: 1024,
    encodings: ["br", "gzip"],
    brotliOptions: { params: { [zlib.BROTLI_PARAM_QUALITY]: 4 } },
  });
  const fastify = app.getHttpAdapter().getInstance();
  fastify.addHook("onSend", async (_req, reply, payload) => {
    reply.header("x-content-type-options", "nosniff");
    reply.header("referrer-policy", "no-referrer");
    reply.header("x-frame-options", "DENY");
    reply.header("cache-control", "no-store");
    return payload;
  });
  app.useGlobalFilters(new AllExceptionsFilter(deps.logger));
  app.enableShutdownHooks();
  await app.init();
  return app;
}
