# Build from the repository root: docker build -f apps/api/Dockerfile .
FROM node:22-slim AS build
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile \
 && pnpm build:packages \
 && pnpm --filter @thoroughline/api build \
 && pnpm --filter @thoroughline/api deploy --prod --legacy /out \
 && cp -r apps/api/dist apps/api/migrations apps/api/assets /out/

FROM node:22-slim
# ffmpeg renders the race videos posted to YouTube, Instagram, Facebook and Threads.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg \
 && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out /app
USER node
EXPOSE 3000
# Migrations run on start (advisory-locked, safe with several replicas).
CMD ["node", "dist/main.js"]
