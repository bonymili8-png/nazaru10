"""Structured logging, correlation/session/operation IDs and an operation lifecycle scope.

Every diagnostic operation runs inside :func:`operation_scope`, which assigns an operation ID, logs
``operation.started`` / ``operation.finished`` (or ``operation.failed``) with duration and outcome,
and reports to the registered metrics sink and error hook. IDs travel in context variables, so log
lines emitted deep inside the protocol stack carry them automatically.
"""

from __future__ import annotations

import contextlib
import contextvars
import json
import logging
import sys
import time
import uuid
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from typing import Any, Protocol

correlation_id_var: contextvars.ContextVar[str | None] = contextvars.ContextVar(
    "correlation_id", default=None
)
diagnostic_session_id_var: contextvars.ContextVar[str | None] = contextvars.ContextVar(
    "diagnostic_session_id", default=None
)
operation_id_var: contextvars.ContextVar[str | None] = contextvars.ContextVar("operation_id", default=None)
trace_var: contextvars.ContextVar[list[dict[str, Any]] | None] = contextvars.ContextVar("trace", default=None)

MAX_TRACE_ENTRIES = 5000

logger = logging.getLogger("jlr.diagnostics")


def new_id() -> str:
    return uuid.uuid4().hex


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "ts": datetime.fromtimestamp(record.created, UTC).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        for key, var in (
            ("correlation_id", correlation_id_var),
            ("diagnostic_session_id", diagnostic_session_id_var),
            ("operation_id", operation_id_var),
        ):
            value = var.get()
            if value:
                payload[key] = value
        extra = getattr(record, "fields", None)
        if isinstance(extra, dict):
            payload.update(extra)
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str)


def configure_logging(level: str = "INFO", *, json_output: bool = True) -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(
        JsonFormatter()
        if json_output
        else logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s")
    )
    root = logging.getLogger()
    root.handlers[:] = [handler]
    root.setLevel(level.upper())


def log_event(level: int, message: str, **fields: Any) -> None:
    logger.log(level, message, extra={"fields": fields})


class MetricsSink(Protocol):
    def observe_operation(self, name: str, outcome: str, seconds: float) -> None: ...


ErrorHook = Callable[[BaseException, dict[str, Any]], None]

_metrics: list[MetricsSink] = []
_error_hooks: list[ErrorHook] = []


def register_metrics_sink(sink: MetricsSink) -> None:
    if sink not in _metrics:
        _metrics.append(sink)


def register_error_hook(hook: ErrorHook) -> None:
    """Error-tracking integration point (e.g. Sentry). Hooks must never raise."""

    if hook not in _error_hooks:
        _error_hooks.append(hook)


@asynccontextmanager
async def operation_scope(name: str, **fields: Any) -> AsyncIterator[str]:
    operation_id = new_id()
    token = operation_id_var.set(operation_id)
    started = time.monotonic()
    log_event(logging.INFO, "operation.started", operation=name, **fields)
    outcome = "ok"
    try:
        yield operation_id
    except BaseException as exc:
        outcome = type(exc).__name__
        log_event(
            logging.WARNING,
            "operation.failed",
            operation=name,
            error=type(exc).__name__,
            error_message=str(exc),
            duration_ms=round((time.monotonic() - started) * 1000, 1),
            **fields,
        )
        for hook in _error_hooks:
            with contextlib.suppress(Exception):  # an error hook must never break the operation
                hook(exc, {"operation": name, "operation_id": operation_id, **fields})
        raise
    finally:
        seconds = time.monotonic() - started
        if outcome == "ok":
            log_event(
                logging.INFO,
                "operation.finished",
                operation=name,
                duration_ms=round(seconds * 1000, 1),
                **fields,
            )
        for sink in _metrics:
            sink.observe_operation(name, outcome, seconds)
        operation_id_var.reset(token)


class TraceCollector:
    """Collects raw request/response records (professional mode) for the current operation."""

    def __init__(self) -> None:
        self.entries: list[dict[str, Any]] = []
        self._token: contextvars.Token[list[dict[str, Any]] | None] | None = None

    def __enter__(self) -> TraceCollector:
        self._token = trace_var.set(self.entries)
        return self

    def __exit__(self, *_: object) -> None:
        if self._token is not None:
            trace_var.reset(self._token)


def trace_hook(entry: dict[str, Any]) -> None:
    entries = trace_var.get()
    if entries is not None and len(entries) < MAX_TRACE_ENTRIES:
        entries.append({"t": time.time(), **entry})
