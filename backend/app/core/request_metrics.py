"""Métricas ligeras por request, sin depender de un proveedor externo.

Los headers ``Server-Timing`` permiten ver en DevTools cuánto tiempo se fue en
PostgreSQL y servicios externos. Los contextvars aíslan requests concurrentes.
"""

from contextvars import ContextVar, Token
from dataclasses import dataclass
from time import perf_counter

from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncEngine


@dataclass
class _MetricState:
    query_count: int
    database_ms: float
    external_ms: dict[str, float]


_metric_state: ContextVar[_MetricState | None] = ContextVar("metric_state", default=None)
_installed_engines: set[int] = set()


@dataclass(frozen=True)
class RequestMetricTokens:
    state: Token


@dataclass(frozen=True)
class RequestMetrics:
    query_count: int
    database_ms: float
    external_ms: dict[str, float]


def begin_request_metrics() -> RequestMetricTokens:
    return RequestMetricTokens(_metric_state.set(_MetricState(0, 0.0, {})))


def finish_request_metrics(tokens: RequestMetricTokens) -> RequestMetrics:
    state = _metric_state.get() or _MetricState(0, 0.0, {})
    metrics = RequestMetrics(state.query_count, state.database_ms, dict(state.external_ms))
    _metric_state.reset(tokens.state)
    return metrics


def record_external_duration(name: str, duration_ms: float) -> None:
    state = _metric_state.get()
    if state is not None:
        state.external_ms[name] = state.external_ms.get(name, 0.0) + duration_ms


def install_db_timing(engine: AsyncEngine) -> None:
    """Instala listeners una sola vez por engine."""
    identity = id(engine)
    if identity in _installed_engines:
        return
    _installed_engines.add(identity)

    @event.listens_for(engine.sync_engine, "before_cursor_execute")
    def _before_cursor_execute(_conn, _cursor, _statement, _parameters, context, _many):
        context._performance_started_at = perf_counter()

    @event.listens_for(engine.sync_engine, "after_cursor_execute")
    def _after_cursor_execute(_conn, _cursor, _statement, _parameters, context, _many):
        started_at = getattr(context, "_performance_started_at", None)
        if started_at is None:
            return
        state = _metric_state.get()
        if state is not None:
            state.query_count += 1
            state.database_ms += (perf_counter() - started_at) * 1000
