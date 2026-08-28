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
        "liveLocationMessage", "lottieStickerMessage", "pinInChatMessage",
    }
    assert required <= routed
    assert len(outputs) == len(rules) + 1
    assert outputs[-1][0]["node"] == "unsupported content"


def test_live_location_and_lottie_sticker_share_the_static_routes():
    assert WORKFLOW is not None
    workflow = json.loads(WORKFLOW.read_text(encoding="utf-8"))
    switch = next(node for node in workflow["nodes"] if node["name"] == "Switch Control type1")
    rules = {rule["outputKey"]: rule for rule in switch["parameters"]["rules"]["values"]}
    outputs = workflow["connections"]["Switch Control type1"]["main"]

    def target_of(key: str) -> str:
        index = next(i for i, rule in enumerate(switch["parameters"]["rules"]["values"]) if rule["outputKey"] == key)
        return outputs[index][0]["node"]

    location_types = {c["rightValue"] for c in rules["location"]["conditions"]["conditions"]}
    assert location_types == {"locationMessage", "liveLocationMessage"}
    assert target_of("location") == "location content"

    sticker_types = {c["rightValue"] for c in rules["sticker"]["conditions"]["conditions"]}
    assert sticker_types == {"stickerMessage", "lottieStickerMessage"}
    assert target_of("sticker") == "get sticker1"


def test_pin_route_shows_action_and_quotes_target_message():
    assert WORKFLOW is not None
    workflow = json.loads(WORKFLOW.read_text(encoding="utf-8"))
    node = next(node for node in workflow["nodes"] if node["name"] == "pin content")
    assignments = {
        item["name"]: item["value"]
        for item in node["parameters"]["assignments"]["assignments"]
    }
    assert assignments["message_type"] == "pin"
    assert "UNPIN_FOR_ALL" in assignments["content"]
    assert "target_wa_message_id" in assignments["payload"]
    assert "pinInChatMessage" in assignments["quoted_wa_message_id"]
    assert workflow["connections"]["pin content"]["main"][0][0]["node"] == "chat input"


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
    assert node["type"] == "n8n-nodes-base.code"
    assert node["typeVersion"] == 2
    code = node["parameters"]["jsCode"]
    assert "safeJson" in code
    assert "message_type: 'interactive'" in code
    assert "pairedItem: { item: 0 }" in code
    assert "={{" not in code
