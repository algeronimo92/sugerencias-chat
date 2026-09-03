"""Tests del bloque Pausa (wait_any): validación de sus condiciones y del
motor de ejecución que pausa una ejecución y la reanuda por timer o por
mensaje del cliente, lo que sea que ocurra primero.
"""

import dataclasses
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from domain_types import AutomationExecutionStatus
from services import automation_service
from services.automation_service import (
    _match_question_button,
    _normalize_question,
    _normalize_wait_any_conditions,
    _run_visual_execution,
)
from tests.conftest import make_chat, make_execution, make_rule


def wait_any_flow():
    return {
        "conditions": {},
        "nodes": [
            {"id": "t", "type": "trigger", "position": {"x": 0, "y": 0}, "data": {"trigger_type": "manual"}},
            {"id": "w", "type": "wait_any", "position": {"x": 0, "y": 0}, "data": {"conditions": [
                {"id": "timer", "kind": "timer", "seconds": 10},
                {"id": "message", "kind": "message"},
            ]}},
            {"id": "e1", "type": "end", "position": {"x": 0, "y": 0}, "data": {"label": "Timer"}},
            {"id": "e2", "type": "end", "position": {"x": 0, "y": 0}, "data": {"label": "Message"}},
        ],
        "edges": [
            {"id": "1", "source": "t", "target": "w", "source_handle": "next"},
            {"id": "2", "source": "w", "target": "e1", "source_handle": "timer"},
            {"id": "3", "source": "w", "target": "e2", "source_handle": "message"},
        ],
    }


def capturing_session(scalar_result=None):
    """FakeSession que acumula, en una lista compartida entre instancias, los
    parámetros de cada UPDATE — _save_execution abre una sesión nueva por
    cada persistencia, así que la lista tiene que vivir fuera de la clase.
    `scalar_result` cubre la consulta de `_last_outbound_media_message_id`."""
    calls: list[dict] = []

    class FakeSession:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        async def scalar(self, stmt):
            return scalar_result

        async def execute(self, stmt):
            calls.append(stmt.compile().params)
            return SimpleNamespace(rowcount=1)

        async def commit(self):
            pass

    return FakeSession, calls


class _Rows:
    """Resultado de `session.execute()`: sirve tanto para `.all()` directo
    (la consulta de ejecuciones en pausa) como para `.mappings().all()` (la
    de mensajes del cliente) — `.mappings()` devuelve el mismo objeto."""
    def __init__(self, rows):
        self._rows = rows

    def all(self):
        return self._rows

    def mappings(self):
        return self


class _DiscoverSession:
    """FakeSession para `_discover_wait_any_replies`, que no usa `deps`: abre
    su propia sesión llamando a `get_sessionmaker()()` directo, así que hay
    que parchear esa función y no `deps.session_factory` como en el resto del
    archivo. Una sola instancia se reutiliza en las dos consultas por
    ejecución (la función abre `async with get_sessionmaker()()` más de una
    vez): `results` se consume en orden a través de toda la llamada — primero
    las ejecuciones en pausa, luego los mensajes candidatos por cada una, y el
    UPDATE si encontró con qué reanudar."""

    def __init__(self, results):
        self._results = iter(results)
        self.executed: list = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def execute(self, stmt):
        self.executed.append(stmt)
        return next(self._results)

    async def commit(self):
        pass


def question_flow():
    return {
        "conditions": {},
        "nodes": [
            {"id": "t", "type": "trigger", "position": {"x": 0, "y": 0}, "data": {"trigger_type": "manual"}},
            {"id": "q", "type": "question", "position": {"x": 0, "y": 0}, "data": {
                "text": "¿Te gustó, {{nombre}}?",
                "buttons": [{"id": "btn_1", "label": "Sí"}, {"id": "btn_2", "label": "No"}],
                "timeout_seconds": 60,
            }},
            {"id": "e1", "type": "end", "position": {"x": 0, "y": 0}, "data": {"label": "Si"}},
            {"id": "e2", "type": "end", "position": {"x": 0, "y": 0}, "data": {"label": "No"}},
            {"id": "e3", "type": "end", "position": {"x": 0, "y": 0}, "data": {"label": "Otra"}},
            {"id": "e4", "type": "end", "position": {"x": 0, "y": 0}, "data": {"label": "Timeout"}},
        ],
        "edges": [
            {"id": "1", "source": "t", "target": "q", "source_handle": "next"},
            {"id": "2", "source": "q", "target": "e1", "source_handle": "btn_1"},
            {"id": "3", "source": "q", "target": "e2", "source_handle": "btn_2"},
            {"id": "4", "source": "q", "target": "e3", "source_handle": "other"},
            {"id": "5", "source": "q", "target": "e4", "source_handle": "timeout"},
        ],
    }


def wait_any_flow_with(*conditions):
    """Variante de wait_any_flow con las condiciones que se le pasen — una
    salida por condición, en el mismo orden."""
    return {
        "conditions": {},
        "nodes": [
            {"id": "t", "type": "trigger", "position": {"x": 0, "y": 0}, "data": {"trigger_type": "manual"}},
            {"id": "w", "type": "wait_any", "position": {"x": 0, "y": 0}, "data": {"conditions": list(conditions)}},
            *[{"id": f"e{i}", "type": "end", "position": {"x": 0, "y": 0}, "data": {"label": c["kind"]}} for i, c in enumerate(conditions)],
        ],
        "edges": [
            {"id": "1", "source": "t", "target": "w", "source_handle": "next"},
            *[{"id": f"e{i}", "source": "w", "target": f"e{i}", "source_handle": c["id"]} for i, c in enumerate(conditions)],
        ],
    }


class TestNormalizeWaitAnyConditions:
    def test_timer_alone_is_valid(self):
        result = _normalize_wait_any_conditions({"conditions": [{"kind": "timer", "seconds": 30}]}, 1)
        assert result == {"conditions": [{"id": "timer", "kind": "timer", "seconds": 30}]}

    def test_timer_and_message_is_valid(self):
        result = _normalize_wait_any_conditions(
            {"conditions": [{"kind": "timer", "seconds": 30}, {"kind": "message"}]}, 1,
        )
        assert result["conditions"] == [
            {"id": "timer", "kind": "timer", "seconds": 30},
            {"id": "message", "kind": "message"},
        ]

    def test_timer_is_mandatory(self):
        with pytest.raises(ValueError, match="agrega un temporizador"):
            _normalize_wait_any_conditions({"conditions": [{"kind": "message"}]}, 1)

    def test_rejects_empty_conditions(self):
        with pytest.raises(ValueError, match="al menos una condición"):
            _normalize_wait_any_conditions({"conditions": []}, 1)

    def test_rejects_duplicate_kind(self):
        with pytest.raises(ValueError, match="no repitas"):
            _normalize_wait_any_conditions(
                {"conditions": [{"kind": "timer", "seconds": 30}, {"kind": "timer", "seconds": 60}]}, 1,
            )

    def test_rejects_unknown_kind(self):
        with pytest.raises(ValueError, match="condición inválida"):
            _normalize_wait_any_conditions({"conditions": [{"kind": "video_opened"}]}, 1)

    @pytest.mark.parametrize("seconds", [0, -5, 604801])
    def test_rejects_timer_seconds_out_of_range(self, seconds):
        with pytest.raises(ValueError, match="1 segundo y 7 días"):
            _normalize_wait_any_conditions({"conditions": [{"kind": "timer", "seconds": seconds}]}, 1)


class TestRunVisualExecutionWaitAny:
    async def test_first_arrival_schedules_the_timer_and_remembers_the_wait(self, deps):
        FakeSession, calls = capturing_session()
        execution = make_execution(flow_state={
            "definition": wait_any_flow(), "flow_version": 0,
            "current_node_id": "w", "path": ["t"],
        })
        rule = make_rule(builder_mode="visual", flow_version=0)

        await _run_visual_execution(
            execution, rule, make_chat(),
            dataclasses.replace(deps, session_factory=lambda: FakeSession),
        )

        assert len(calls) == 1
        params = calls[0]
        assert params["status"] == AutomationExecutionStatus.SCHEDULED
        state = params["flow_state"]
        assert state["current_node_id"] == "w"
        assert state["waiting_at_node"] == "w"
        assert state["awaiting"] == ["message"]
        assert "waiting_since" in state
        now = datetime.now(timezone.utc)
        assert now < params["scheduled_for"] <= now + timedelta(seconds=11)

    async def test_resumes_via_message_branch_when_flagged(self, deps):
        FakeSession, calls = capturing_session()
        execution = make_execution(flow_state={
            "definition": wait_any_flow(), "flow_version": 0,
            "current_node_id": "w", "path": ["t", "w"],
            "waiting_at_node": "w", "waiting_since": "2026-01-01T00:00:00+00:00",
            "awaiting_message": True, "resume_reason": "message",
        })
        rule = make_rule(builder_mode="visual", flow_version=0)

        await _run_visual_execution(
            execution, rule, make_chat(),
            dataclasses.replace(deps, session_factory=lambda: FakeSession),
        )

        final = calls[-1]
        assert final["status"] == AutomationExecutionStatus.COMPLETED
        assert final["flow_state"]["current_node_id"] is None
        wait_result = next(r for r in final["action_results"] if r["type"] == "wait_any")
        assert wait_result["branch"] == "message"

    async def test_resumes_via_timer_branch_when_no_message_arrived(self, deps):
        FakeSession, calls = capturing_session()
        execution = make_execution(flow_state={
            "definition": wait_any_flow(), "flow_version": 0,
            "current_node_id": "w", "path": ["t", "w"],
            "waiting_at_node": "w", "waiting_since": "2026-01-01T00:00:00+00:00",
            "awaiting_message": True,
        })
        rule = make_rule(builder_mode="visual", flow_version=0)

        await _run_visual_execution(
            execution, rule, make_chat(),
            dataclasses.replace(deps, session_factory=lambda: FakeSession),
        )

        final = calls[-1]
        wait_result = next(r for r in final["action_results"] if r["type"] == "wait_any")
        assert wait_result["branch"] == "timer"


class TestRunVisualExecutionWaitAnyBusinessHours:
    async def test_overrides_the_natural_branch_when_outside_business_hours(self, deps, monkeypatch):
        monkeypatch.setattr("services.automation_service.is_business_hours", lambda now: False)
        FakeSession, calls = capturing_session()
        flow = wait_any_flow_with(
            {"id": "timer", "kind": "timer", "seconds": 10},
            {"id": "business_hours", "kind": "business_hours"},
        )
        execution = make_execution(flow_state={
            "definition": flow, "flow_version": 0,
            "current_node_id": "w", "path": ["t", "w"],
            "waiting_at_node": "w", "waiting_since": "2026-01-01T00:00:00+00:00",
            "awaiting_message": False,
        })
        rule = make_rule(builder_mode="visual", flow_version=0)

        await _run_visual_execution(
            execution, rule, make_chat(),
            dataclasses.replace(deps, session_factory=lambda: FakeSession),
        )

        final = calls[-1]
        wait_result = next(r for r in final["action_results"] if r["type"] == "wait_any")
        assert wait_result["branch"] == "business_hours"

    async def test_does_not_override_when_within_business_hours(self, deps, monkeypatch):
        monkeypatch.setattr("services.automation_service.is_business_hours", lambda now: True)
        FakeSession, calls = capturing_session()
        flow = wait_any_flow_with(
            {"id": "timer", "kind": "timer", "seconds": 10},
            {"id": "business_hours", "kind": "business_hours"},
        )
        execution = make_execution(flow_state={
            "definition": flow, "flow_version": 0,
            "current_node_id": "w", "path": ["t", "w"],
            "waiting_at_node": "w", "waiting_since": "2026-01-01T00:00:00+00:00",
            "awaiting_message": False,
        })
        rule = make_rule(builder_mode="visual", flow_version=0)

        await _run_visual_execution(
            execution, rule, make_chat(),
            dataclasses.replace(deps, session_factory=lambda: FakeSession),
        )

        final = calls[-1]
        wait_result = next(r for r in final["action_results"] if r["type"] == "wait_any")
        assert wait_result["branch"] == "timer"


class TestRunVisualExecutionWaitAnyMediaPlayed:
    async def test_first_arrival_looks_up_the_last_outbound_media_message(self, deps):
        FakeSession, calls = capturing_session(scalar_result="WA123")
        flow = wait_any_flow_with(
            {"id": "timer", "kind": "timer", "seconds": 10},
            {"id": "media_played", "kind": "media_played"},
        )
        execution = make_execution(flow_state={
            "definition": flow, "flow_version": 0, "current_node_id": "w", "path": ["t"],
        })
        rule = make_rule(builder_mode="visual", flow_version=0)

        await _run_visual_execution(
            execution, rule, make_chat(),
            dataclasses.replace(deps, session_factory=lambda: FakeSession),
        )

        state = calls[0]["flow_state"]
        assert state["watching_message_id"] == "WA123"

    async def test_resumes_via_media_played_branch_when_flagged(self, deps):
        FakeSession, calls = capturing_session()
        flow = wait_any_flow_with(
            {"id": "timer", "kind": "timer", "seconds": 10},
            {"id": "media_played", "kind": "media_played"},
        )
        execution = make_execution(flow_state={
            "definition": flow, "flow_version": 0,
            "current_node_id": "w", "path": ["t", "w"],
            "waiting_at_node": "w", "waiting_since": "2026-01-01T00:00:00+00:00",
            "awaiting_message": False, "watching_message_id": "WA123",
            "resume_reason": "media_played",
        })
        rule = make_rule(builder_mode="visual", flow_version=0)

        await _run_visual_execution(
            execution, rule, make_chat(),
            dataclasses.replace(deps, session_factory=lambda: FakeSession),
        )

        final = calls[-1]
        wait_result = next(r for r in final["action_results"] if r["type"] == "wait_any")
        assert wait_result["branch"] == "media_played"


class TestNormalizeQuestion:
    def test_valid_question(self):
        result = _normalize_question({"text": "Hola", "buttons": ["Si", "No"], "timeout_seconds": 60}, 1)
        assert result == {
            "text": "Hola",
            "buttons": [{"id": "btn_1", "label": "Si"}, {"id": "btn_2", "label": "No"}],
            "timeout_seconds": 60,
        }

    def test_requires_text(self):
        with pytest.raises(ValueError, match="escribe el mensaje"):
            _normalize_question({"text": "", "buttons": ["Si"], "timeout_seconds": 60}, 1)

    def test_requires_at_least_one_button(self):
        with pytest.raises(ValueError, match="entre 1 y 3 botones"):
            _normalize_question({"text": "Hola", "buttons": [], "timeout_seconds": 60}, 1)

    def test_rejects_more_than_three_buttons(self):
        with pytest.raises(ValueError, match="entre 1 y 3 botones"):
            _normalize_question({"text": "Hola", "buttons": ["A", "B", "C", "D"], "timeout_seconds": 60}, 1)

    def test_ignores_blank_button_labels(self):
        result = _normalize_question({"text": "Hola", "buttons": ["Si", "  ", "No"], "timeout_seconds": 60}, 1)
        assert [b["label"] for b in result["buttons"]] == ["Si", "No"]

    def test_accepts_object_buttons_from_the_visual_editor(self):
        # El editor visual manda {id, label} en vez de strings simples,
        # para poder asignarle un id estable al handle del grafo.
        result = _normalize_question({
            "text": "Hola",
            "buttons": [{"id": "btn_1", "label": "Si"}, {"id": "btn_2", "label": "No"}],
            "timeout_seconds": 60,
        }, 1)
        assert [b["label"] for b in result["buttons"]] == ["Si", "No"]

    @pytest.mark.parametrize("seconds", [0, -1, 604801])
    def test_rejects_timeout_out_of_range(self, seconds):
        with pytest.raises(ValueError, match="1 segundo y 7 días"):
            _normalize_question({"text": "Hola", "buttons": ["Si"], "timeout_seconds": seconds}, 1)


class TestMatchQuestionButton:
    BUTTONS = [{"id": "btn_1", "label": "Sí"}, {"id": "btn_2", "label": "No"}]

    def test_matches_by_selected_id_from_a_native_button_click(self):
        assert _match_question_button(self.BUTTONS, "interactive", "Sí", {"selected_id": "btn_2"}) == "btn_2"

    def test_matches_by_position_number_from_the_text_fallback(self):
        assert _match_question_button(self.BUTTONS, "text", "2", None) == "btn_2"

    def test_matches_by_label_case_and_accent_insensitive(self):
        assert _match_question_button(self.BUTTONS, "text", " SI ", None) == "btn_1"

    def test_falls_back_to_other_when_nothing_matches(self):
        assert _match_question_button(self.BUTTONS, "text", "tal vez", None) == "other"

    def test_a_photo_goes_to_its_own_branch_when_connected(self):
        # 9 de cada 10 fotos llegan sin caption: por texto no matchearía
        # ningún botón y caería en "otra respuesta" —la rama del cliente que
        # NO mandó lo pedido— si no se resolviera antes por tipo.
        assert _match_question_button(
            self.BUTTONS, "image", None, None,
            kind="media_received", has_media_handle=True,
        ) == "media"

    def test_a_photo_falls_back_to_other_when_the_flow_did_not_connect_media(self):
        # Un flujo publicado antes de que existiera la salida "media" no debe
        # cambiar de comportamiento: sigue siendo "otra respuesta".
        assert _match_question_button(
            self.BUTTONS, "image", None, None,
            kind="media_received", has_media_handle=False,
        ) == "other"


class TestRunVisualExecutionQuestion:
    async def test_first_arrival_sends_buttons_and_pauses(self, deps, outbox):
        # Ya no resuelve acá si son botones nativos o el fallback de texto:
        # eso quedó a cargo del worker del outbox en el momento real del
        # envío (ver _send_buttons_message), así que no hace falta mockear
        # get_instance_capabilities para este test.
        FakeSession, calls = capturing_session()
        execution = make_execution(flow_state={
            "definition": question_flow(), "flow_version": 0,
            "current_node_id": "q", "path": ["t"],
        })
        rule = make_rule(builder_mode="visual", flow_version=0)

        await _run_visual_execution(
            execution, rule, make_chat(),
            dataclasses.replace(deps, session_factory=lambda: FakeSession),
        )

        assert len(outbox.enqueued) == 1
        chat_id, items = outbox.enqueued[0]
        assert chat_id == "51999@s.whatsapp.net"
        payload = items[0]["payload"]
        assert payload["type"] == "interactive"
        assert payload["interactive_type"] == "buttons"
        assert payload["config"]["title"] == "¿Te gustó, Ana?"
        assert [b["displayText"] for b in payload["config"]["buttons"]] == ["Sí", "No"]
        assert len(calls) == 1
        state = calls[0]["flow_state"]
        assert state["waiting_at_node"] == "q"
        assert state["awaiting"] == ["message"]
        assert state["question_buttons"] == [{"id": "btn_1", "label": "Sí"}, {"id": "btn_2", "label": "No"}]

    async def test_resumes_via_the_matched_button_branch(self, deps):
        FakeSession, calls = capturing_session()
        execution = make_execution(flow_state={
            "definition": question_flow(), "flow_version": 0,
            "current_node_id": "q", "path": ["t", "q"],
            "waiting_at_node": "q", "waiting_since": "2026-01-01T00:00:00+00:00",
            "awaiting_message": True, "resume_reason": "btn_2",
        })
        rule = make_rule(builder_mode="visual", flow_version=0)

        await _run_visual_execution(
            execution, rule, make_chat(),
            dataclasses.replace(deps, session_factory=lambda: FakeSession),
        )

        final = calls[-1]
        result = next(r for r in final["action_results"] if r["type"] == "question")
        assert result["branch"] == "btn_2"

    async def test_resumes_via_other_when_reply_does_not_match_any_button(self, deps):
        FakeSession, calls = capturing_session()
        execution = make_execution(flow_state={
            "definition": question_flow(), "flow_version": 0,
            "current_node_id": "q", "path": ["t", "q"],
            "waiting_at_node": "q", "waiting_since": "2026-01-01T00:00:00+00:00",
            "awaiting_message": True, "resume_reason": "other",
        })
        rule = make_rule(builder_mode="visual", flow_version=0)

        await _run_visual_execution(
            execution, rule, make_chat(),
            dataclasses.replace(deps, session_factory=lambda: FakeSession),
        )

        final = calls[-1]
        result = next(r for r in final["action_results"] if r["type"] == "question")
        assert result["branch"] == "other"

    async def test_resumes_via_timeout_when_nobody_answered(self, deps):
        FakeSession, calls = capturing_session()
        execution = make_execution(flow_state={
            "definition": question_flow(), "flow_version": 0,
            "current_node_id": "q", "path": ["t", "q"],
            "waiting_at_node": "q", "waiting_since": "2026-01-01T00:00:00+00:00",
            "awaiting_message": True,
        })
        rule = make_rule(builder_mode="visual", flow_version=0)

        await _run_visual_execution(
            execution, rule, make_chat(),
            dataclasses.replace(deps, session_factory=lambda: FakeSession),
        )

        final = calls[-1]
        result = next(r for r in final["action_results"] if r["type"] == "question")
        assert result["branch"] == "timeout"


class TestDiscoverWaitAnyReplies:
    """`_discover_wait_any_replies` corre cada minuto y decide, para cada
    ejecución pausada, cuál de los mensajes que llegaron desde entonces es la
    respuesta que la reanuda — a diferencia del resto del archivo, no pasa por
    `_run_visual_execution` así que necesita su propia sesión falsa (ver
    `_DiscoverSession` arriba)."""

    async def test_album_envelope_is_skipped_and_the_photo_that_follows_resumes(self, monkeypatch):
        # Un envío de varias fotos manda primero el sobre `albumMessage`
        # (unsupported, sin media) y milisegundos después la imagen real. Sin
        # filtrarlo, el sobre vacío sería el que reanuda el flujo.
        session = _DiscoverSession([
            _Rows([(100, "51999@s.whatsapp.net", {
                "waiting_since": "2026-01-01T00:00:00+00:00",
                "awaiting": ["media_received"],
            })]),
            _Rows([
                {
                    "id": 1, "wa_message_id": "ALBUM-1", "message_type": "unsupported",
                    "content": None, "payload": {"original_type": "albumMessage"}, "analysis": None,
                },
                {
                    "id": 2, "wa_message_id": "PHOTO-1", "message_type": "image",
                    "content": None, "payload": None,
                    "analysis": {"summary": "Primer plano de un rostro"},
                },
            ]),
            None,
        ])
        monkeypatch.setattr(automation_service, "get_sessionmaker", lambda: (lambda: session))

        await automation_service._discover_wait_any_replies()

        params = session.executed[-1].compile().params
        assert params["flow_state"]["resume_reason"] == "media_received"
        assert params["flow_state"]["message_context"]["message_id"] == "PHOTO-1"
        assert params["flow_state"]["message_context"]["analysis_summary"] == "Primer plano de un rostro"

    async def test_text_reply_is_skipped_when_only_awaiting_the_photo(self, monkeypatch):
        # Un bloque que sólo espera la foto (sin rama "message") no debe
        # despertarse con un "ahorita te la mando": sigue esperando hasta que
        # llegue el adjunto de verdad, sin importar el orden de llegada.
        session = _DiscoverSession([
            _Rows([(100, "51999@s.whatsapp.net", {
                "waiting_since": "2026-01-01T00:00:00+00:00",
                "awaiting": ["media_received"],
            })]),
            _Rows([
                {
                    "id": 1, "wa_message_id": "TXT-1", "message_type": "text",
                    "content": "ahorita te la mando", "payload": None, "analysis": None,
                },
                {
                    "id": 2, "wa_message_id": "PHOTO-1", "message_type": "image",
                    "content": None, "payload": None,
                    "analysis": {"summary": "Comprobante de pago Yape"},
                },
            ]),
            None,
        ])
        monkeypatch.setattr(automation_service, "get_sessionmaker", lambda: (lambda: session))

        await automation_service._discover_wait_any_replies()

        params = session.executed[-1].compile().params
        assert params["flow_state"]["resume_reason"] == "media_received"
        assert params["flow_state"]["message_context"]["message_id"] == "PHOTO-1"

    async def test_a_message_only_block_still_resumes_on_the_first_reply(self, monkeypatch):
        # Contraste con el test anterior: cuando el bloque sí espera
        # "message" (el caso de siempre), no cambia nada — resuelve con la
        # primera respuesta, sea texto o foto.
        session = _DiscoverSession([
            _Rows([(100, "51999@s.whatsapp.net", {
                "waiting_since": "2026-01-01T00:00:00+00:00",
                "awaiting": ["message"],
            })]),
            _Rows([
                {
                    "id": 1, "wa_message_id": "TXT-1", "message_type": "text",
                    "content": "ahorita te la mando", "payload": None, "analysis": None,
                },
            ]),
            None,
        ])
        monkeypatch.setattr(automation_service, "get_sessionmaker", lambda: (lambda: session))

        await automation_service._discover_wait_any_replies()

        params = session.executed[-1].compile().params
        assert params["flow_state"]["resume_reason"] == "message"
        assert params["flow_state"]["message_context"]["message_id"] == "TXT-1"
