# Backend images (API and diagnostic gateway) built from the uv workspace.
#   docker build -f docker/python.Dockerfile --target api .
#   docker build -f docker/python.Dockerfile --target gateway .

FROM python:3.12-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_LINK_MODE=copy \
    UV_COMPILE_BYTECODE=1 \
    UV_PYTHON_DOWNLOADS=never \
    UV_PROJECT_ENVIRONMENT=/opt/venv
# Optional extra CA bundle for builds behind a TLS-intercepting proxy (build secret "extra_ca"; empty = none).
RUN --mount=type=secret,id=extra_ca,required=false \
    if [ -s /run/secrets/extra_ca ]; then export PIP_CERT=/run/secrets/extra_ca; fi; \
    pip install --no-cache-dir "uv==0.8.*"
WORKDIR /src
COPY pyproject.toml uv.lock ./
COPY packages ./packages
COPY apps/api/pyproject.toml ./apps/api/pyproject.toml
COPY apps/api/src ./apps/api/src
COPY apps/diagnostic-gateway/pyproject.toml ./apps/diagnostic-gateway/pyproject.toml
COPY apps/diagnostic-gateway/src ./apps/diagnostic-gateway/src

FROM base AS build-api
RUN --mount=type=secret,id=extra_ca,required=false \
    if [ -s /run/secrets/extra_ca ]; then export SSL_CERT_FILE=/run/secrets/extra_ca; fi; \
    uv sync --frozen --no-dev --no-editable --package jlr-api

FROM base AS build-gateway
RUN --mount=type=secret,id=extra_ca,required=false \
    if [ -s /run/secrets/extra_ca ]; then export SSL_CERT_FILE=/run/secrets/extra_ca; fi; \
    uv sync --frozen --no-dev --no-editable --package jlr-gateway

FROM python:3.12-slim AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PATH="/opt/venv/bin:$PATH"
RUN useradd --system --uid 10001 --home /nonexistent --shell /usr/sbin/nologin app
WORKDIR /app
USER app

FROM runtime AS api
COPY --from=build-api /opt/venv /opt/venv
EXPOSE 8000
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=5 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/api/v1/health', timeout=2).status == 200 else 1)"
# Applies Alembic migrations, then serves the API.
CMD ["python", "-m", "jlr_api", "all"]

FROM runtime AS gateway
COPY --from=build-gateway /opt/venv /opt/venv
EXPOSE 8100
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=5 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8100/health', timeout=2).status == 200 else 1)"
CMD ["python", "-m", "jlr_gateway"]
