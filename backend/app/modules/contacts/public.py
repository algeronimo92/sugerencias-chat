"""Contrato de ``contacts`` para la integración con Meta: lo que llega de la
app WhatsApp Business del celular y el registro del pedido de sincronización."""

from app.modules.contacts.sync_service import (
    apply_app_contacts as apply_whatsapp_app_contacts,
    apply_history as apply_whatsapp_history,
    record_sync_request as record_whatsapp_app_sync,
    syncs_to_retry as whatsapp_app_syncs_to_retry,
)
from app.modules.contacts.whatsapp_app import without_history_threads


__all__ = [
    "apply_whatsapp_app_contacts",
    "apply_whatsapp_history",
    "record_whatsapp_app_sync",
    "whatsapp_app_syncs_to_retry",
    "without_history_threads",
]
