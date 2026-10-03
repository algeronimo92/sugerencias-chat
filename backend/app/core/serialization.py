"""Filas crudas convertidas a algo que se pueda mandar como JSON."""

from datetime import date, datetime

from app.core.time_format import iso_utc_micros


def json_safe_row(row: dict) -> dict:
    """Convierte una fila cruda (``SELECT *`` vía SQL crudo) a JSON-safe:
    datetime/date a ISO, bytes a None (no serializable, sin uso fuera de la
    app). Lo demás (str, int, bool, dict de columnas JSONB) ya es JSON-safe."""
    result = {}
    for key, value in row.items():
        if isinstance(value, datetime):
            result[key] = iso_utc_micros(value)
        elif isinstance(value, date):
            result[key] = value.isoformat()
        elif isinstance(value, (bytes, bytearray)):
            result[key] = None
        else:
            result[key] = value
    return result
