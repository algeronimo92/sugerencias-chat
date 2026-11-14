"""Arma un .xlsx a partir de hojas ya calculadas.

Excel y no CSV: un CSV con comas se abre en una sola columna en un Excel
configurado en español (usa punto y coma), pierde las tildes sin BOM y
convierte los teléfonos en números que se comen el "+51".

Cada celda se escribe con su tipo explícito y la conversión automática de
textos queda apagada: el nombre de un contacto de WhatsApp es texto del
cliente, y uno que empiece con "=" no puede convertirse en una fórmula al
abrir el archivo en la computadora de la dueña.
"""

import re
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
from io import BytesIO
from typing import Any, Literal

import xlsxwriter

from app.modules.leads.dashboard.scope import BUSINESS_TIMEZONE

ColumnKind = Literal["text", "integer", "money", "date", "datetime"]

# Excel corta una celda en 32 767 caracteres y el nombre de una hoja en 31.
_MAX_CELL = 32_767
_MAX_SHEET_NAME = 31
# Caracteres de control que el XML del .xlsx no admite; vienen pegados en
# mensajes o nombres copiados de otras apps.
_CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f]")


@dataclass(frozen=True)
class Column:
    header: str
    kind: ColumnKind = "text"
    width: int = 18


@dataclass(frozen=True)
class Sheet:
    name: str
    columns: list[Column]
    rows: list[list[Any]]


def _text(value: Any) -> str:
    return _CONTROL.sub("", str(value))[:_MAX_CELL]


def _local(value: datetime) -> datetime:
    """Excel no guarda zona horaria: la hora se escribe como la ve el negocio."""
    if value.tzinfo is None:
        return value
    return value.astimezone(BUSINESS_TIMEZONE).replace(tzinfo=None)


def build_workbook(sheets: list[Sheet]) -> bytes:
    buffer = BytesIO()
    workbook = xlsxwriter.Workbook(
        buffer,
        {
            "in_memory": True,
            "strings_to_formulas": False,
            "strings_to_numbers": False,
            "strings_to_urls": False,
        },
    )
    header = workbook.add_format({"bold": True, "bg_color": "#E7F3EE", "bottom": 1, "text_wrap": True, "valign": "top"})
    formats = {
        "integer": workbook.add_format({"num_format": "0"}),
        "money": workbook.add_format({"num_format": "#,##0.00"}),
        "date": workbook.add_format({"num_format": "dd/mm/yyyy"}),
        "datetime": workbook.add_format({"num_format": "dd/mm/yyyy hh:mm"}),
    }
    for sheet in sheets:
        worksheet = workbook.add_worksheet(sheet.name[:_MAX_SHEET_NAME])
        for column_index, column in enumerate(sheet.columns):
            worksheet.write_string(0, column_index, column.header, header)
            worksheet.set_column(column_index, column_index, column.width)
        for row_index, row in enumerate(sheet.rows, start=1):
            for column_index, (column, value) in enumerate(zip(sheet.columns, row)):
                _write(worksheet, row_index, column_index, column.kind, value, formats)
        worksheet.freeze_panes(1, 0)
        if sheet.rows:
            worksheet.autofilter(0, 0, len(sheet.rows), len(sheet.columns) - 1)
    workbook.close()
    return buffer.getvalue()


def _write(worksheet, row: int, column: int, kind: ColumnKind, value: Any, formats: dict) -> None:
    if value is None or value == "":
        return
    if kind in ("integer", "money") and isinstance(value, (int, float, Decimal)):
        worksheet.write_number(row, column, float(value), formats[kind])
    elif kind == "datetime" and isinstance(value, datetime):
        worksheet.write_datetime(row, column, _local(value), formats["datetime"])
    elif kind == "date" and isinstance(value, date):
        worksheet.write_datetime(row, column, value, formats["date"])
    else:
        worksheet.write_string(row, column, _text(value))


__all__ = ["Column", "Sheet", "build_workbook"]
