"""Despacho de eventos de dominio en sus dos fases, sin base de datos."""

from dataclasses import dataclass

import pytest

from app.core import events
from app.core.events import DomainEvent, Phase, dispatch_after_commit, dispatch_in_transaction, subscribe


@dataclass(frozen=True, kw_only=True)
class Happened(DomainEvent):
    value: int


@dataclass(frozen=True, kw_only=True)
class HappenedAgain(Happened):
    pass


@pytest.fixture(autouse=True)
def isolated_registry(monkeypatch):
    monkeypatch.setattr(events, "_handlers", {})


async def test_each_phase_only_runs_its_own_handlers():
    seen = []

    @subscribe(Happened, phase=Phase.TRANSACTION)
    async def in_tx(event):
        seen.append(("tx", event.value))

    @subscribe(Happened, phase=Phase.AFTER_COMMIT)
    async def after(event):
        seen.append(("after", event.value))

    await dispatch_in_transaction([Happened(value=1)])
    assert seen == [("tx", 1)]
    await dispatch_after_commit([Happened(value=2)])
    assert seen == [("tx", 1), ("after", 2)]


async def test_a_subclass_reaches_the_handlers_of_its_parent():
    seen = []

    @subscribe(Happened, phase=Phase.TRANSACTION)
    async def on_happened(event):
        seen.append(type(event).__name__)

    await dispatch_in_transaction([HappenedAgain(value=1)])
    assert seen == ["HappenedAgain"]


async def test_events_raised_by_handlers_are_dispatched_in_the_same_pass():
    pending: list[DomainEvent] = [Happened(value=1)]
    seen = []

    @subscribe(Happened, phase=Phase.TRANSACTION)
    async def cascade(event):
        seen.append(event.value)
        if event.value < 3:
            pending.append(Happened(value=event.value + 1))

    await dispatch_in_transaction(pending)
    assert seen == [1, 2, 3]


async def test_a_cycle_between_handlers_is_cut_instead_of_hanging():
    pending: list[DomainEvent] = [Happened(value=1)]

    @subscribe(Happened, phase=Phase.TRANSACTION)
    async def forever(event):
        pending.append(Happened(value=event.value))

    with pytest.raises(RuntimeError):
        await dispatch_in_transaction(pending)


async def test_a_transaction_handler_failure_propagates():
    @subscribe(Happened, phase=Phase.TRANSACTION)
    async def boom(_event):
        raise ValueError("no")

    with pytest.raises(ValueError):
        await dispatch_in_transaction([Happened(value=1)])


async def test_an_after_commit_failure_does_not_stop_the_others():
    seen = []

    @subscribe(Happened, phase=Phase.AFTER_COMMIT)
    async def boom(_event):
        raise ValueError("no")

    @subscribe(Happened, phase=Phase.AFTER_COMMIT)
    async def still_runs(event):
        seen.append(event.value)

    await dispatch_after_commit([Happened(value=7)])
    assert seen == [7]


def test_subscribing_twice_does_not_duplicate():
    async def handler(_event):
        return None

    subscribe(Happened, phase=Phase.TRANSACTION)(handler)
    subscribe(Happened, phase=Phase.TRANSACTION)(handler)
    assert events.handlers_for(Happened(value=1), Phase.TRANSACTION) == [handler]
