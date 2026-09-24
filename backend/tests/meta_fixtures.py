"""Fixtures oficiales de Meta y armado de webhooks completos para los tests."""

from __future__ import annotations

import copy
import json
from pathlib import Path
from typing import Any

FIXTURES = Path(__file__).resolve().parent / "fixtures" / "meta"

PHONE_NUMBER_ID = "109876543210987"
DISPLAY_PHONE_NUMBER = "51999000111"
WABA_ID = "200000000000001"
DEFAULT_CONTACT = {"profile": {"name": "Ana Cliente"}, "wa_id": "51987654321"}


def _load(name: str) -> dict[str, Any]:
    data = json.loads((FIXTURES / name).read_text(encoding="utf-8"))
    data.pop("_comment", None)
    return data


def inbound_cases() -> dict[str, dict[str, Any]]:
    return _load("inbound_messages.json")


def outbound_cases() -> dict[str, dict[str, Any]]:
    return _load("outbound_messages.json")


def status_cases() -> dict[str, dict[str, Any]]:
    return _load("statuses.json")


def inbound_message(name: str) -> dict[str, Any]:
    return copy.deepcopy(inbound_cases()[name]["message"])


def webhook_body(
    value: dict[str, Any],
    *,
    field: str = "messages",
    entry_id: str = WABA_ID,
) -> dict[str, Any]:
    return {
        "object": "whatsapp_business_account",
        "entry": [{"id": entry_id, "changes": [{"value": value, "field": field}]}],
    }


def messages_value(
    messages: list[dict[str, Any]],
    *,
    contacts: list[dict[str, Any]] | None = None,
    phone_number_id: str = PHONE_NUMBER_ID,
) -> dict[str, Any]:
    return {
        "messaging_product": "whatsapp",
        "metadata": {"display_phone_number": DISPLAY_PHONE_NUMBER, "phone_number_id": phone_number_id},
        "contacts": contacts if contacts is not None else [copy.deepcopy(DEFAULT_CONTACT)],
        "messages": messages,
    }


def inbound_webhook(name: str) -> dict[str, Any]:
    case = inbound_cases()[name]
    contact = case.get("contact", DEFAULT_CONTACT)
    return webhook_body(messages_value([copy.deepcopy(case["message"])], contacts=[copy.deepcopy(contact)]))


def statuses_webhook(*names: str, phone_number_id: str = PHONE_NUMBER_ID) -> dict[str, Any]:
    statuses = [copy.deepcopy(status_cases()[name]) for name in names]
    return webhook_body({
        "messaging_product": "whatsapp",
        "metadata": {"display_phone_number": DISPLAY_PHONE_NUMBER, "phone_number_id": phone_number_id},
        "statuses": statuses,
    })
