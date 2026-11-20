"""Contadores de la integración con Meta (sección 7 del plan de refactor).

Un tipo que la UI todavía no sabe mostrar, un medio que no se pudo bajar o
una salida rechazada no rompen nada, y justamente por eso necesitan una señal
propia: si no, se pierden hasta que alguien mira un chat puntual.
"""

from prometheus_client import Counter, Gauge, Histogram

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
webhook_ignored_extra_number_messages = Counter(
    "meta_webhook_ignored_extra_number_messages_total",
    "Mensajes que llegaron al número de avisos de cita: no abren chats",
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

# API de Conversiones (eventos de anuncios Click-to-WhatsApp hacia Meta).
meta_conversions_sent = Counter(
    "meta_conversions_sent_total",
    "Eventos de conversión que Meta confirmó recibir",
    ["event_name"],
)
meta_conversions_failed = Counter(
    "meta_conversions_failed_total",
    "Eventos de conversión que Meta rechazó de forma definitiva, por código de error",
    ["code"],
)
meta_conversions_skipped = Counter(
    "meta_conversions_skipped_total",
    "Eventos de conversión que no se mandan, por motivo",
    ["reason"],
)

# Llamadas de voz (docs/analisis/17-plan-llamadas-whatsapp.md, §4.8).
call_events = Counter(
    "meta_call_events_total",
    "Eventos de llamadas de Meta procesados, por tipo",
    ["event"],
)
call_unknown_error_codes = Counter(
    "meta_call_unknown_error_codes_total",
    "Códigos de error de llamadas de Meta que el catálogo de causas no conoce",
    ["code"],
)
call_notice_delay_seconds = Histogram(
    "meta_call_notice_delay_seconds",
    "Segundos entre que el webhook guardó el aviso de una llamada y se procesó. "
    "Meta da 30 a 60 s para atender: una demora de segundos acá es una llamada que suena tarde.",
    buckets=(0.25, 0.5, 1, 2, 3, 5, 10, 30, 60),
)

# La cola de entrada (public.webhook_inbox). La de salida tenía gauges desde
# hace meses y esta ninguno: un evento que agotaba sus diez intentos —por
# ejemplo, con el token de Meta de un negocio vencido— desaparecía del CRM sin
# una sola señal, y el equipo se enteraba cuando el paciente reclamaba.
# Son de toda la plataforma: el inbox no es de ningún negocio.
webhook_inbox_pending = Gauge(
    "meta_webhook_inbox_pending",
    "Eventos de Meta esperando, en curso o fallidos que todavía se reintentan",
)
webhook_inbox_exhausted = Gauge(
    "meta_webhook_inbox_exhausted",
    "Eventos de Meta que agotaron sus intentos y siguen en el inbox (se purgan a los 7 días)",
)
webhook_inbox_exhausted_last_hour = Gauge(
    "meta_webhook_inbox_exhausted_last_hour",
    "Eventos de Meta que agotaron sus intentos en la última hora",
)
webhook_inbox_oldest_pending_age_seconds = Gauge(
    "meta_webhook_inbox_oldest_pending_age_seconds",
    "Antigüedad del evento de Meta pendiente más viejo del inbox",
)
