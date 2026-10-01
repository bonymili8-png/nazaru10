# Telegram Mini App: static build served by nginx, which also proxies /api to the backend.
FROM node:22-alpine AS build
WORKDIR /app
COPY apps/telegram-mini-app/package.json apps/telegram-mini-app/package-lock.json ./
# Optional extra CA bundle for builds behind a TLS-intercepting proxy (build secret "extra_ca").
RUN --mount=type=secret,id=extra_ca,required=false \
    if [ -s /run/secrets/extra_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/extra_ca; fi; \
    npm ci --no-audit --no-fund
COPY apps/telegram-mini-app/ ./
# VITE_DEV_AUTH=true lets the app sign in outside Telegram (only works when the API has ALLOW_DEV_AUTH=true).
ARG VITE_DEV_AUTH=false
ENV VITE_DEV_AUTH=$VITE_DEV_AUTH
RUN npm run build

FROM nginx:1.27-alpine
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY docker/nginx-security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=10s --timeout=3s --retries=5 CMD wget -qO- http://127.0.0.1/healthz >/dev/null || exit 1
