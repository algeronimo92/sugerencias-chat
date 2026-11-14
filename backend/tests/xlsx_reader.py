"""Lector mínimo de .xlsx para los tests: valores y fórmulas por celda.

No hay openpyxl en el proyecto (el backend solo escribe planillas), y para
comprobar qué quedó en cada celda alcanza con leer el XML del archivo.
"""

import re
import zipfile
from io import BytesIO
from xml.etree import ElementTree

_NS = {"x": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}


def _shared_strings(archive: zipfile.ZipFile) -> list[str]:
    if "xl/sharedStrings.xml" not in archive.namelist():
        return []
    root = ElementTree.fromstring(archive.read("xl/sharedStrings.xml"))
    return ["".join(node.itertext()) for node in root.findall("x:si", _NS)]


def sheet_names(content: bytes) -> list[str]:
    with zipfile.ZipFile(BytesIO(content)) as archive:
        root = ElementTree.fromstring(archive.read("xl/workbook.xml"))
    return [sheet.attrib["name"] for sheet in root.findall("x:sheets/x:sheet", _NS)]


def read_sheet(content: bytes, index: int = 1) -> list[list]:
    """Filas de la hoja ``index`` (desde 1): texto como str, números como
    float. Las celdas vacías quedan en None."""
    with zipfile.ZipFile(BytesIO(content)) as archive:
        strings = _shared_strings(archive)
        root = ElementTree.fromstring(archive.read(f"xl/worksheets/sheet{index}.xml"))
    rows: list[list] = []
    for row in root.findall("x:sheetData/x:row", _NS):
        values: dict[int, object] = {}
        for cell in row.findall("x:c", _NS):
            letters = re.match(r"[A-Z]+", cell.attrib["r"]).group(0)
            column = 0
            for letter in letters:
                column = column * 26 + (ord(letter) - 64)
            value = cell.find("x:v", _NS)
            if cell.find("x:f", _NS) is not None:
                values[column] = ("FORMULA", cell.find("x:f", _NS).text)
            elif value is None:
                values[column] = None
            elif cell.attrib.get("t") == "s":
                values[column] = strings[int(value.text)]
            else:
                values[column] = float(value.text)
        width = max(values) if values else 0
        rows.append([values.get(column) for column in range(1, width + 1)])
    return rows
