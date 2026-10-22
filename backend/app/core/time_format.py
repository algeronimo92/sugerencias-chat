"""Los dos formatos de fecha que la API manda al frontend.

Son distintos a propósito y **no se pueden unificar**:

- `iso_utc` es el de uso general (tareas, notas, notificaciones, reportes).
  Omite los microsegundos cuando son cero, que es lo que devuelve `isoformat`.
- `iso_utc_micros` siempre los escribe, y es el de los mensajes y de todo lo
  que se pagina por cursor: ese mismo string vuelve como cursor y se relee con
  `parse_iso_utc_micros`, que exige los seis dígitos. Truncar a segundos genera
  colisiones falsas entre mensajes del mismo segundo.

`iso_utc_micros` pega la Z sin mirar la zona, así que solo recibe datetimes ya
normalizados a UTC.
"""

from datetime import datetime, timezone

MICROS_FORMAT = "%Y-%m-%dT%H:%M:%S.%fZ"


def iso_utc(value: datetime | None) -> str | None:
    return value.isoformat().replace("+00:00", "Z") if value else None


def iso_utc_micros(value: datetime | None) -> str | None:
    return value.strftime(MICROS_FORMAT) if value else None


def parse_iso_utc_micros(value: str) -> datetime:
    return datetime.strptime(value, MICROS_FORMAT).replace(tzinfo=timezone.utc)
