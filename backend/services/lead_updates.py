"""Traducción de los campos de la API (``models.schemas.LeadUpdate``) a las
columnas reales de ``leads`` (``db.models.Lead``)."""

LEAD_FIELD_TO_COLUMN = {
    "phone": "telefono",
    "secondary_phone": "telefono_secundario",
    "name": "nombre",
    "servicio_interes": "servicio_interes",
    "vendedor_id": "vendedor_id",
    "origen": "origen",
    "notas": "notas",
    "con_especialista": "con_especialista",
    "automatizacion_pausada": "automatizacion_pausada",
    "conversacion_abierta": "conversacion_abierta",
    "razon_perdido": "razon_perdido",
    "fecha_recontacto": "fecha_recontacto",
    "proxima_cita": "proxima_cita",
}

NOT_NULL_FLAGS = frozenset({
    "con_especialista",
    "automatizacion_pausada",
    "conversacion_abierta",
})


def lead_column_values(fields: dict) -> dict:
    """Un null explícito sobre una columna NOT NULL se ignora en vez de
    reventar contra la base."""
    return {
        LEAD_FIELD_TO_COLUMN[name]: value
        for name, value in fields.items()
        if not (LEAD_FIELD_TO_COLUMN[name] in NOT_NULL_FLAGS and value is None)
    }
