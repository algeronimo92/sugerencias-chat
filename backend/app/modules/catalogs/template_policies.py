"""Pure policies and value types shared by cases and atomic persistence."""
from __future__ import annotations
from datetime import datetime, timezone
from app.core.time_format import iso_utc

def _template(row, attachments: list[dict] | None = None):
    return {
        "id": row["id"], "name": row["name"], "content": row["content"],
        "shortcut": row["shortcut"], "category": row["category"], "stage": row["stage"],
        "task_type": row["task_type"], "service": row["service"], "is_active": row["is_active"],
        "visibility": row["visibility"], "is_favorite": bool(row["is_favorite"]),
        "template_type": row["template_type"], "official_name": row["official_name"],
        "official_language": row["official_language"], "official_category": row["official_category"],
        "official_status": row["official_status"],
        "official_rejected_reason": row["official_rejected_reason"],
        "official_parameter_values": row["official_parameter_values"] or [],
        "meta_template_id": row["meta_template_id"],
        "official_header_type": row["official_header_type"],
        "official_header_text": row["official_header_text"],
        "official_header_media_asset_id": row["official_header_media_asset_id"],
        "official_header_media_url": row["official_header_media_url"],
        "official_header_media_content_type": row["official_header_media_content_type"],
        "official_header_media_filename": row["official_header_media_filename"],
        "official_footer": row["official_footer"],
        "official_buttons": row["official_buttons"] or [],
        "interactive_type": row["interactive_type"],
        "interactive_config": row["interactive_config"] or {},
        "imported_from_meta": bool(row["imported_from_meta"]),
        "last_used_at": iso_utc(row["last_used_at"]), "use_count": int(row["use_count"] or 0),
        "created_by_user_id": row["created_by_user_id"],
        "created_by_name": row["created_by_name"],
        "created_at": iso_utc(row["created_at"]),
        "attachments": attachments or [],
    }

def _meta_managed_template_values(
    remote: dict,
    current_header_media_asset_id: int | None,
) -> dict:
    """Convierte la representacion completa de Meta a columnas locales.

    Solo devuelve campos cuyo origen de verdad es Meta. Nombre visible,
    categoria interna, atajo, etapa y valores de variables siguen siendo
    configuracion propia del CRM y no deben perderse durante el reemplazo.
    """

    components = remote.get("components") or []

    def component(kind: str) -> dict | None:
        return next(
            (item for item in components if str(item.get("type") or "").upper() == kind),
            None,
        )

    body = component("BODY") or {}
    header = component("HEADER") or {}
    footer = component("FOOTER") or {}
    buttons_component = component("BUTTONS") or {}

    header_format = str(header.get("format") or "").upper()
    if header_format == "TEXT":
        header_type = "text"
        header_text = header.get("text")
        header_media_asset_id = None
    elif header_format == "IMAGE":
        header_type = "image"
        header_text = None
        # El GET de Meta no entrega el binario listo para enviar. Se conserva
        # el asset local mientras el encabezado siga siendo de imagen.
        header_media_asset_id = current_header_media_asset_id
    else:
        header_type = "none"
        header_text = None
        header_media_asset_id = None

    buttons: list[dict] = []
    for button in buttons_component.get("buttons") or []:
        button_type = str(button.get("type") or "").upper()
        if button_type == "QUICK_REPLY":
            buttons.append({"type": "quick_reply", "text": button.get("text", "")})
        elif button_type == "URL":
            buttons.append({
                "type": "url",
                "text": button.get("text", ""),
                "url": button.get("url", ""),
            })
        elif button_type == "PHONE_NUMBER":
            buttons.append({
                "type": "phone_number",
                "text": button.get("text", ""),
                "phone_number": button.get("phone_number", ""),
            })

    rejected_reason = remote.get("rejected_reason")
    if rejected_reason and str(rejected_reason).upper() == "NONE":
        rejected_reason = None

    return {
        "content": body.get("text") or "",
        "official_name": remote.get("name"),
        "official_language": remote.get("language"),
        "official_category": remote.get("category"),
        "official_status": remote.get("status") or "PENDING",
        "official_rejected_reason": rejected_reason,
        "official_header_type": header_type,
        "official_header_text": header_text,
        "official_header_media_asset_id": header_media_asset_id,
        "official_footer": footer.get("text"),
        "official_buttons": buttons,
        "updated_at": datetime.now(timezone.utc),
    }

def _references_template(value: object, template_id: int) -> bool:
    """Busca referencias dentro de acciones simples o definiciones visuales."""
    if isinstance(value, dict):
        raw_template_id = value.get("template_id")
        try:
            if raw_template_id is not None and int(raw_template_id) == template_id:
                return True
        except (TypeError, ValueError):
            pass
        return any(_references_template(item, template_id) for item in value.values())
    if isinstance(value, list):
        return any(_references_template(item, template_id) for item in value)
    return False
