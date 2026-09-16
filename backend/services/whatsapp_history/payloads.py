"""Constructores de payload por tipo de nodo de WhatsApp.

Cada uno saca los datos estables de su nodo y descarta lo sensible o efímero
(tokens, URLs firmadas, claves de cifrado)."""

import json
import re
from typing import Any


def _caption(media: dict) -> str:
    caption = media.get("caption")
    return caption if isinstance(caption, str) else ""


def _first_text(*values: Any) -> str | None:
    for value in values:
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def _long_value(value: Any) -> int | str | None:
    """Normaliza los Long de protobuf que Evolution serializa de varias formas."""
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, (int, str)):
        return value
    if isinstance(value, dict):
        low = value.get("low")
        high = value.get("high", 0)
        if isinstance(low, int) and isinstance(high, int):
            # Reconstrucción con signo equivalente a Long de protobuf.
            return (high << 32) + (low & 0xFFFFFFFF)
    return None


_CURRENCY_SYMBOLS = {"PEN": "S/", "USD": "$"}


_PAYMENT_STATUS_LABELS = {
    "captured": "Realizado",
    "pending": "Pendiente",
    "failed": "Fallido",
    "canceled": "Cancelado",
    "cancelled": "Cancelado",
    "declined": "Rechazado",
    "refunded": "Reembolsado",
}


_ORDER_STATUS_LABELS = {
    "completed": "Completado",
    "payment_requested": "Pendiente de pago",
    "canceled": "Cancelado",
    "cancelled": "Cancelado",
    "declined": "Rechazado",
    "processing": "En proceso",
}


def _humanize(raw: str | None) -> str | None:
    if not raw:
        return None
    text = raw.replace("_", " ")
    return text[:1].upper() + text[1:]


def _format_payment_text(button: dict) -> str | None:
    amount = button.get("amount")
    if amount is None:
        return None
    currency = button.get("currency")
    symbol = _CURRENCY_SYMBOLS.get(currency, f"{currency} " if currency else "")
    amount_text = f"{symbol}{amount:.2f}"
    label = button.get("item_name")
    if label:
        return f"Solicitud de pago: {label} - {amount_text}"
    return f"Solicitud de pago - {amount_text}"


def _format_flow_text(button: dict) -> str | None:
    """Texto legible para las actualizaciones de un pedido de WhatsApp Flow
    (creación, cambio de estado de pago, cambio de estado del pedido).
    Cada una llega como un botón distinto de `nativeFlowMessage` con su
    propio `name`, por eso se resuelve por ese campo."""
    name = button.get("name")
    if name == "payment_status" and button.get("payment_status"):
        status = button["payment_status"]
        return f"Pago: {_PAYMENT_STATUS_LABELS.get(status) or _humanize(status)}"
    if name == "review_order" and button.get("order_status"):
        status = button["order_status"]
        return f"Estado: {_ORDER_STATUS_LABELS.get(status) or _humanize(status)}"
    if name == "review_and_pay":
        return _format_payment_text(button)
    return None


def _flow_buttons_payload(node: dict) -> tuple[list[dict], str | None]:
    """Botones de `nativeFlowMessage` (ej. solicitudes de pago vía WhatsApp
    Flow). `buttonParamsJson` trae campos propios por tipo de botón (pago,
    cita, etc.) que no calzan con el resto de mensajes interactivos, por eso
    se procesan aparte."""
    native_flow = node.get("nativeFlowMessage") if isinstance(node.get("nativeFlowMessage"), dict) else {}
    raw_buttons = native_flow.get("buttons") if isinstance(native_flow.get("buttons"), list) else []
    buttons = []
    flow_text = None
    for button in raw_buttons:
        if not isinstance(button, dict):
            continue
        params = {}
        raw_params = button.get("buttonParamsJson")
        if isinstance(raw_params, str):
            try:
                parsed = json.loads(raw_params)
                params = parsed if isinstance(parsed, dict) else {}
            except (TypeError, ValueError):
                pass
        order = params.get("order") if isinstance(params.get("order"), dict) else {}
        items = order.get("items") if isinstance(order.get("items"), list) else []
        total_amount = params.get("total_amount") if isinstance(params.get("total_amount"), dict) else {}
        amount = None
        total_value, total_offset = total_amount.get("value"), total_amount.get("offset")
        if isinstance(total_value, (int, float)) and isinstance(total_offset, (int, float)) and total_offset:
            amount = total_value / total_offset
        subtotal_amount = order.get("subtotal") if isinstance(order.get("subtotal"), dict) else {}
        subtotal = None
        subtotal_value, subtotal_offset = subtotal_amount.get("value"), subtotal_amount.get("offset")
        if isinstance(subtotal_value, (int, float)) and isinstance(subtotal_offset, (int, float)) and subtotal_offset:
            subtotal = subtotal_value / subtotal_offset
        item = items[0] if items and isinstance(items[0], dict) else {}
        item_name = item.get("name") or params.get("additional_note")
        button_text = button.get("buttonText")
        entry = {
            "id": button.get("buttonId") or button.get("id") or params.get("id"),
            "text": button_text.get("displayText") if isinstance(button_text, dict) else None,
            "name": button.get("name") or params.get("type"),
            "amount": amount,
            "subtotal": subtotal,
            "currency": params.get("currency"),
            "reference_id": params.get("reference_id"),
            "order_status": order.get("status"),
            "payment_status": params.get("payment_status"),
            "item_name": item_name.strip() if isinstance(item_name, str) else item_name,
            "quantity": item.get("quantity"),
        }
        buttons.append({key: value for key, value in entry.items() if value not in (None, "")})
        if flow_text is None:
            flow_text = _format_flow_text(entry)
    return buttons, flow_text


def _interactive_payload(message_type: str, node: dict) -> dict:
    body = node.get("body") if isinstance(node.get("body"), dict) else {}
    header = node.get("header") if isinstance(node.get("header"), dict) else {}
    footer = node.get("footer") if isinstance(node.get("footer"), dict) else {}
    options = []
    sections = node.get("sections") if isinstance(node.get("sections"), list) else []
    for section in sections:
        if not isinstance(section, dict):
            continue
        rows = section.get("rows") if isinstance(section.get("rows"), list) else []
        for row in rows:
            if isinstance(row, dict):
                options.append({
                    "id": row.get("rowId") or row.get("id"),
                    "text": row.get("title") or row.get("name"),
                    "description": row.get("description"),
                })
    buttons, flow_text = _flow_buttons_payload(node)
    result = {
        "original_type": message_type,
        "title": node.get("title") or header.get("title"),
        "body": body.get("text") or node.get("contentText") or node.get("description"),
        "footer": footer.get("text") or node.get("footerText"),
        "options": options,
        "buttons": buttons,
        "flow_text": flow_text,
    }
    return {key: value for key, value in result.items() if value not in (None, [], "")}


def _order_payload(order: dict) -> dict:
    """Datos estables de orderMessage; omite token y demás campos sensibles."""
    result = {
        "original_type": "orderMessage",
        "order_id": order.get("orderId"),
        "title": order.get("orderTitle"),
        "message": order.get("message"),
        "item_count": _long_value(order.get("itemCount")),
        "status": order.get("status"),
        "surface": order.get("surface"),
        "total_amount_1000": _long_value(order.get("totalAmount1000")),
        "currency": order.get("totalCurrencyCode"),
    }
    return {key: value for key, value in result.items() if value is not None}


def _poll_snapshot_results(raw: Any) -> list[dict]:
    if not isinstance(raw, list):
        return []
    results = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        voters = item.get("voters") if isinstance(item.get("voters"), list) else []
        option = _first_text(item.get("optionName"), item.get("option"), item.get("name"))
        if option:
            results.append({"option": option, "count": len(voters), "voters": voters})
    return results


def _product_payload(message: dict) -> dict:
    product = message.get("product") if isinstance(message.get("product"), dict) else {}
    result = {
        "original_type": "productMessage",
        "product_id": product.get("productId"),
        "retailer_id": product.get("retailerId"),
        "title": product.get("title"),
        "description": product.get("description"),
        "body": message.get("body"),
        "footer": message.get("footer"),
        "price_amount_1000": _long_value(product.get("priceAmount1000")),
        "sale_price_amount_1000": _long_value(product.get("salePriceAmount1000")),
        "currency": product.get("currencyCode"),
        "url": product.get("url") or product.get("signedUrl"),
        "image_url": (product.get("productImage") or {}).get("url")
            if isinstance(product.get("productImage"), dict) else None,
    }
    return {key: value for key, value in result.items() if value is not None}


def _payment_payload(message_type: str, payment: dict) -> dict:
    amount = payment.get("amount1000") or payment.get("amount")
    currency = payment.get("currencyCode") or payment.get("currency")
    result = {
        "original_type": message_type,
        "payment_kind": message_type.removesuffix("Message"),
        "transaction_id": payment.get("transactionId") or payment.get("paymentRequestId"),
        "amount_1000": _long_value(amount),
        "currency": currency,
        "note": payment.get("noteMessage") or payment.get("note") or payment.get("message"),
        "status": payment.get("status") or payment.get("serviceType"),
        "expiry_timestamp": _long_value(payment.get("expiryTimestamp")),
    }
    return {key: value for key, value in result.items() if value is not None}


_VCARD_WAID = re.compile(r"waid=(\d+)", re.IGNORECASE)


# El TEL puede venir agrupado con un prefijo ("item1.TEL"), que es como lo
# manda WhatsApp desde Android.
_VCARD_TEL = re.compile(r"^(?:[A-Za-z0-9-]+\.)?TEL[^:\r\n]*:(.*)$", re.IGNORECASE | re.MULTILINE)


def _contact_entry(contact: dict) -> dict:
    """Un contacto compartido, con el teléfono sacado del vCard.

    El número solo viaja dentro del vCard: ``waid`` lo trae en formato
    internacional (es el JID sin dominio) y el valor visible del ``TEL`` suele
    venir en formato local. Sin él el frontend no puede ofrecer abrirle el
    chat, que es lo único que se hace con un contacto compartido.
    """
    vcard = contact.get("vcard")
    vcard = vcard if isinstance(vcard, str) else ""
    tel = _VCARD_TEL.search(vcard)
    waid = _VCARD_WAID.search(vcard)
    phone = waid.group(1) if waid else (tel.group(1).strip() if tel else None)
    return {
        "fullName": contact.get("displayName") or "sin nombre",
        "phoneNumber": phone,
    }
