import ast
import re
from pathlib import Path

import pytest

from services.realtime_events import ChatsUpdateReason, RealtimeEvent

BACKEND = Path(__file__).resolve().parent.parent
FRONTEND_REALTIME = BACKEND.parent / "frontend" / "src" / "realtime"
EMITTERS = {"broadcast", "send_to_user"}
PASSTHROUGH_EMITTERS = {"automation_deps.py", "ws_manager.py"}


def _constant_values(node: ast.AST, assignments: dict[str, list[ast.AST]]) -> set[str] | None:
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return {node.value}
    if isinstance(node, ast.IfExp):
        body = _constant_values(node.body, assignments)
        orelse = _constant_values(node.orelse, assignments)
        return body | orelse if body is not None and orelse is not None else None
    if isinstance(node, ast.Name) and node.id in assignments:
        values = [_constant_values(value, assignments) for value in assignments[node.id]]
        return set().union(*values) if values and all(value is not None for value in values) else None
    return None


def _emitted_events():
    for path in [*sorted((BACKEND / "routers").glob("*.py")), *sorted((BACKEND / "services").glob("*.py")), BACKEND / "main.py"]:
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for function in ast.walk(tree):
            if not isinstance(function, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            assignments: dict[str, list[ast.AST]] = {}
            for node in ast.walk(function):
                if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
                    assignments.setdefault(node.targets[0].id, []).append(node.value)
            for node in ast.walk(function):
                if not (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr in EMITTERS and node.args):
                    continue
                payload = node.args[-1]
                if isinstance(payload, ast.Name) and len(assignments.get(payload.id, [])) == 1:
                    payload = assignments[payload.id][0]
                location = f"{path.relative_to(BACKEND)}:{node.lineno}"
                if isinstance(payload, ast.Dict):
                    fields = {key.value: value for key, value in zip(payload.keys, payload.values) if isinstance(key, ast.Constant)}
                    yield location, fields, assignments
                elif path.name not in PASSTHROUGH_EMITTERS:
                    yield location, None, assignments


def test_every_emitted_event_type_and_reason_is_part_of_the_contract():
    violations = []
    for location, fields, assignments in _emitted_events():
        if fields is None:
            violations.append(f"{location} payload no analizable")
            continue
        event_types = _constant_values(fields["type"], assignments) if "type" in fields else None
        if event_types is None or not event_types <= set(RealtimeEvent):
            violations.append(f"{location} type={event_types}")
        if "reason" in fields:
            reasons = _constant_values(fields["reason"], assignments)
            if reasons is None or not reasons <= set(ChatsUpdateReason):
                violations.append(f"{location} reason={reasons}")

    assert violations == []


def _frontend_string_union(source: str, constant: str) -> set[str]:
    match = re.search(rf"export const {constant} = \[(.*?)\] as const", source, re.S)
    assert match, f"{constant} no está declarado"
    return set(re.findall(r"'([a-z_]+)'", match.group(1)))


@pytest.mark.skipif(not FRONTEND_REALTIME.exists(), reason="el frontend no está en este checkout")
def test_frontend_declares_the_same_realtime_contract():
    source = (FRONTEND_REALTIME / "socketEvents.ts").read_text(encoding="utf-8")

    assert _frontend_string_union(source, "REALTIME_EVENT_TYPES") == set(RealtimeEvent)
    assert _frontend_string_union(source, "CHATS_UPDATE_REASONS") == set(ChatsUpdateReason)
