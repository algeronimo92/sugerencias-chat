"""PDFs mínimos generados en código para los tests: texto en Helvetica o una
página sin texto (lo que produce un escaneo). Sin archivos binarios en el repo."""

from __future__ import annotations


def _escape(text: str) -> str:
    return text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def make_pdf(pages: list[list[str]]) -> bytes:
    """Una página por lista de líneas; lista vacía = página sin texto."""
    objects: list[bytes] = []
    page_ids = []
    font_id = 3
    next_id = 4
    page_objects: list[tuple[int, int, bytes]] = []
    for lines in pages:
        page_id, content_id = next_id, next_id + 1
        next_id += 2
        page_ids.append(page_id)
        ops = ["BT", "/F1 12 Tf", "14 TL", "72 720 Td"]
        for line in lines:
            ops.append(f"({_escape(line)}) Tj T*")
        ops.append("ET")
        stream = "\n".join(ops).encode("latin-1")
        page_objects.append((page_id, content_id, stream))

    objects_by_id: dict[int, bytes] = {
        1: b"<< /Type /Catalog /Pages 2 0 R >>",
        2: ("<< /Type /Pages /Kids [" + " ".join(f"{pid} 0 R" for pid in page_ids) + f"] /Count {len(page_ids)} >>").encode(),
        font_id: b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    }
    for page_id, content_id, stream in page_objects:
        objects_by_id[page_id] = (
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 {font_id} 0 R >> >> "
            f"/Contents {content_id} 0 R >>"
        ).encode()
        objects_by_id[content_id] = f"<< /Length {len(stream)} >>\nstream\n".encode() + stream + b"\nendstream"

    out = bytearray(b"%PDF-1.4\n")
    offsets = {}
    for obj_id in sorted(objects_by_id):
        offsets[obj_id] = len(out)
        out += f"{obj_id} 0 obj\n".encode() + objects_by_id[obj_id] + b"\nendobj\n"
    xref = len(out)
    size = max(objects_by_id) + 1
    out += f"xref\n0 {size}\n0000000000 65535 f \n".encode()
    for obj_id in range(1, size):
        out += f"{offsets[obj_id]:010d} 00000 n \n".encode()
    out += f"trailer\n<< /Size {size} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    return bytes(out)
