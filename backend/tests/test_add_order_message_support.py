import copy
import importlib.util
from pathlib import Path


SCRIPT_PATH = Path(__file__).resolve().parents[2] / "scripts" / "add_order_message_support.py"
SPEC = importlib.util.spec_from_file_location("add_order_message_support", SCRIPT_PATH)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)
update_workflow = MODULE.update_workflow


def _workflow() -> dict:
    fallback = {
        "id": "fallback-id",
        "name": "unsupported content",
        "position": [100, 200],
        "parameters": {
            "assignments": {
                "assignments": [
                    {"id": "a", "name": "content", "value": "={{ null }}", "type": "string"},
                    {"id": "b", "name": "message_type", "value": "unsupported", "type": "string"},
                    {"id": "c", "name": "payload", "value": "={{ ({}) }}", "type": "object"},
                    {"id": "d", "name": "media_url", "value": "=", "type": "string"},
                    {"id": "e", "name": "quoted_wa_message_id", "value": "={{ null }}", "type": "string"},
                    {"id": "f", "name": "chat_id", "value": "canonical", "type": "string"},
                ]
            }
        },
    }
    switch = {
        "id": "switch-id",
        "name": "Switch Control type1",
        "parameters": {"rules": {"values": [{"conditions": {"conditions": [{"rightValue": "conversation"}]}}]}},
    }
    return {
        "nodes": [switch, fallback],
        "connections": {
            "Switch Control type1": {"main": [[{"node": "text content"}], [{"node": "unsupported content"}]]},
            "unsupported content": {"main": [[{"node": "chat input", "type": "main", "index": 0}]]},
        },
    }


def test_adds_order_rule_before_fallback_and_normalized_node():
    workflow = _workflow()

    assert update_workflow(workflow) is True

    order = next(node for node in workflow["nodes"] if node["name"] == "order content")
    assignments = {
        item["name"]: item for item in order["parameters"]["assignments"]["assignments"]
    }
    assert assignments["message_type"]["value"] == "order"
    assert "total_amount_1000" in assignments["payload"]["value"]
    assert "orderRequestMessageId" in assignments["quoted_wa_message_id"]["value"]
    assert workflow["connections"]["Switch Control type1"]["main"][1][0]["node"] == "order content"
    assert workflow["connections"]["Switch Control type1"]["main"][2][0]["node"] == "unsupported content"


def test_transformation_is_idempotent():
    workflow = _workflow()
    update_workflow(workflow)
    once = copy.deepcopy(workflow)

    assert update_workflow(workflow) is False
    assert workflow == once
