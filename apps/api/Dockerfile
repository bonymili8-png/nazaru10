# Build from the repository root: docker build -f apps/api/Dockerfile .
FROM node:22-slim AS build
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile \
 && pnpm build:packages \
 && pnpm --filter @thoroughline/api build \
 && pnpm --filter @thoroughline/api deploy --prod --legacy /out \
 && cp -r apps/api/dist apps/api/migrations /out/

FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out /app
USER node
EXPOSE 3000
# Migrations run on start (advisory-locked, safe with several replicas).
CMD ["node", "dist/main.js"]
