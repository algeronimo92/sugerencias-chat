import json
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[2]
WORKFLOW = next(iter(sorted(ROOT.glob("rag*.json"))), None)
pytestmark = pytest.mark.skipif(WORKFLOW is None, reason="El workflow local no se versiona")


def test_priority_types_have_routes_and_fallback_stays_last():
    assert WORKFLOW is not None
    workflow = json.loads(WORKFLOW.read_text(encoding="utf-8"))
    switch = next(node for node in workflow["nodes"] if node["name"] == "Switch Control type1")
    rules = switch["parameters"]["rules"]["values"]
    outputs = workflow["connections"]["Switch Control type1"]["main"]
    routed = {
        condition["rightValue"]
        for rule in rules
        for condition in rule["conditions"]["conditions"]
    }
    required = {
        "listMessage", "listResponseMessage", "interactiveMessage", "interactiveResponseMessage",
        "templateButtonReplyMessage", "ptvMessage", "pollCreationMessageV2",
        "pollCreationMessageV3", "pollCreationMessageV4", "pollCreationMessageV5",
        "pollResultSnapshotMessage", "pollUpdateMessage", "productMessage",
        "invoiceMessage", "requestPaymentMessage", "sendPaymentMessage",
        "paymentInviteMessage", "cancelPaymentRequestMessage", "declinePaymentRequestMessage",
        "viewOnceMessage", "viewOnceMessageV2", "viewOnceMessageV2Extension",
    }
    assert required <= routed
    assert len(outputs) == len(rules) + 1
    assert outputs[-1][0]["node"] == "unsupported content"


def test_ptv_chain_and_poll_update_are_connected():
    assert WORKFLOW is not None
    workflow = json.loads(WORKFLOW.read_text(encoding="utf-8"))
    assert workflow["connections"]["get ptv"]["main"][0][0]["node"] == "Convert to ptv"
    assert workflow["connections"]["upload ptv media"]["main"][0][0]["node"] == "ptv content"
    assert workflow["connections"]["ptv content"]["main"][0][0]["node"] == "chat input"
    poll_webhook = next(node for node in workflow["nodes"] if node["name"] == "poll results webhook")
    assert poll_webhook["parameters"]["url"].endswith("/api/webhooks/poll-results")


def test_view_once_keeps_only_metadata_and_skips_media_download_chain():
    assert WORKFLOW is not None
    workflow = json.loads(WORKFLOW.read_text(encoding="utf-8"))
    node = next(node for node in workflow["nodes"] if node["name"] == "view once content")
    assignments = {
        item["name"]: item["value"]
        for item in node["parameters"]["assignments"]["assignments"]
    }
    assert assignments["message_type"] == "view_once"
    assert assignments["media_url"] == "="
    assert "mediaKey" not in assignments["payload"]
    assert "directPath" not in assignments["payload"]
    assert workflow["connections"]["view once content"]["main"][0][0]["node"] == "chat input"


def test_interactive_expressions_are_compatible_with_n8n_2_31_parser():
    assert WORKFLOW is not None
    workflow = json.loads(WORKFLOW.read_text(encoding="utf-8"))
    node = next(node for node in workflow["nodes"] if node["name"] == "priority interactive content")
    values = [
        item["value"]
        for item in node["parameters"]["assignments"]["assignments"]
        if item["name"] in {"content", "payload"}
    ]
    assert all("catch{" not in value and "catch (" in value for value in values)
