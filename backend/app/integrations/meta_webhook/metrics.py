"""Contadores de la integración con Meta (sección 7 del plan de refactor).

Un tipo que la UI todavía no sabe mostrar, un medio que no se pudo bajar o
una salida rechazada no rompen nada, y justamente por eso necesitan una señal
propia: si no, se pierden hasta que alguien mira un chat puntual.
"""

from prometheus_client import Counter

webhook_signature_rejected = Counter(
    "meta_webhook_signature_rejected_total",
    "POST del webhook de Meta rechazados por firma HMAC inválida o ausente",
)
webhook_duplicate_changes = Counter(
    "meta_webhook_duplicate_changes_total",
    "Changes de Meta que ya estaban en el inbox (reintentos de entrega)",
)
webhook_unrouted_changes = Counter(
    "meta_webhook_unrouted_changes_total",
    "Changes de Meta cuyo número o WABA no pertenece a ningún negocio activo",
    ["field"],
)
webhook_ignored_fields = Counter(
    "meta_webhook_ignored_fields_total",
    "Changes de Meta de un field que el backend todavía no procesa",
    ["field"],
)
unrendered_messages = Counter(
    "meta_unrendered_messages_total",
    "Mensajes guardados con un tipo o subtipo que el contrato todavía no conoce",
    ["message_type", "message_subtype"],
)
unknown_statuses = Counter(
    "meta_unknown_statuses_total",
    "Estados de Meta guardados que el contrato todavía no conoce",
    ["status"],
)
unmatched_messages = Counter(
    "meta_unmatched_messages_total",
    "Eventos de Meta que no se pudieron asociar a un lead",
    ["kind"],
)
media_download_failures = Counter(
    "meta_media_download_failures_total",
    "Adjuntos entrantes que no se pudieron descargar de Meta",
    ["message_type"],
)
outbound_rejected = Counter(
    "meta_outbound_rejected_total",
    "Salidas rechazadas antes de llegar a Meta (tipo no enviable, capacidad o ventana)",
    ["reason"],
)
outbound_meta_errors = Counter(
    "meta_outbound_errors_total",
    "Errores devueltos por Meta al enviar o informados luego como estado failed",
    ["code"],
)
outbound_payload_mismatch = Counter(
    "meta_outbound_payload_mismatch_total",
    "Envíos cuyo cuerpo final difiere del registrado en el outbox más allá de to y los ids de medios",
)
