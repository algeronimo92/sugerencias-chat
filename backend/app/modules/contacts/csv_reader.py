"""Lectura de un CSV de contactos: codificación, separador, encabezados y el
mapeo de columnas que se sugiere a partir de sus nombres.

Excel en español guarda con ``;`` y en Latin-1 o UTF-8 con BOM, y es de
donde sale la mayoría de estas listas: por eso se prueban esas variantes
antes de rendirse."""

from __future__ import annotations

import csv
import io
import unicodedata
from dataclasses import dataclass

MAX_BYTES = 5 * 1024 * 1024
MAX_ROWS = 20_000

# Campos de la agenda que una columna puede llenar.
FIELDS = ("nombre", "telefono", "email", "etiquetas", "notas", "consentimiento")

_ALIASES: dict[str, tuple[str, ...]] = {
    "nombre": ("nombre", "nombres", "name", "full name", "nombre completo", "cliente", "contacto", "paciente"),
    "telefono": (
        "telefono", "tel", "celular", "movil", "whatsapp", "phone", "phone number", "numero",
        "mobile", "cel", "telefono movil", "numero de telefono",
    ),
    "email": ("email", "correo", "e-mail", "mail", "correo electronico"),
    "etiquetas": ("etiquetas", "etiqueta", "tags", "tag", "grupo", "segmento", "labels"),
    "notas": ("notas", "nota", "notes", "comentarios", "observaciones"),
    "consentimiento": ("consentimiento", "opt in", "optin", "acepta marketing", "acepta publicidad", "consent"),
}


class CsvFormatError(ValueError):
    """El archivo no se puede leer como CSV de contactos."""


@dataclass
class CsvTable:
    headers: list[str]
    rows: list[list[str]]


def _normalized(header: str) -> str:
    plain = unicodedata.normalize("NFKD", header).encode("ascii", "ignore").decode()
    return " ".join(plain.casefold().replace("_", " ").replace("-", " ").split())


def _decode(content: bytes) -> str:
    for encoding in ("utf-8-sig", "cp1252", "latin-1"):
        try:
            return content.decode(encoding)
        except UnicodeDecodeError:
            continue
    raise CsvFormatError("No se pudo leer el archivo: guárdalo como CSV UTF-8")


def _delimiter(sample: str) -> str:
    try:
        return csv.Sniffer().sniff(sample, delimiters=",;\t|").delimiter
    except csv.Error:
        first = sample.splitlines()[0] if sample else ""
        return max((",", ";", "\t"), key=first.count)


def read_csv(content: bytes) -> CsvTable:
    if not content.strip():
        raise CsvFormatError("El archivo está vacío")
    if len(content) > MAX_BYTES:
        raise CsvFormatError("El archivo supera los 5 MB")
    if content[:4] == b"PK\x03\x04":
        raise CsvFormatError("Es un archivo de Excel: en Excel usa Guardar como > CSV UTF-8")
    text = _decode(content)
    reader = csv.reader(io.StringIO(text, newline=""), delimiter=_delimiter(text[:4096]))
    try:
        records = [row for row in reader if any(cell.strip() for cell in row)]
    except csv.Error as exc:
        raise CsvFormatError(f"El CSV está mal formado: {exc}") from exc
    if len(records) < 2:
        raise CsvFormatError("El archivo no tiene filas debajo de los encabezados")
    headers = [cell.strip() or f"Columna {index + 1}" for index, cell in enumerate(records[0])]
    rows = records[1:]
    if len(rows) > MAX_ROWS:
        raise CsvFormatError(f"El archivo tiene {len(rows)} filas; el máximo es {MAX_ROWS}")
    return CsvTable(headers=headers, rows=rows)


def suggest_mapping(headers: list[str]) -> dict[str, int | None]:
    """Campo -> índice de la columna que más se le parece, o None."""
    normalized = [_normalized(header) for header in headers]
    mapping: dict[str, int | None] = {}
    taken: set[int] = set()
    for field_name in FIELDS:
        aliases = _ALIASES[field_name]
        match = next(
            (index for index, header in enumerate(normalized) if header in aliases and index not in taken),
            None,
        )
        if match is None:
            match = next(
                (
                    index for index, header in enumerate(normalized)
                    if index not in taken and any(alias in header for alias in aliases if len(alias) > 3)
                ),
                None,
            )
        if match is not None:
            taken.add(match)
        mapping[field_name] = match
    return mapping


def mapped_values(row: list[str], mapping: dict[str, int | None]) -> dict[str, str | None]:
    return {
        field_name: (row[index] if index is not None and index < len(row) else None)
        for field_name, index in mapping.items()
    }
