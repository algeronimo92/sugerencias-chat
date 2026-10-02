"""Pure policies and value types shared by cases and atomic persistence."""
from __future__ import annotations
from pathlib import Path

def _asset(row) -> dict:
    created_at = row["created_at"]
    return {
        "id": row["id"],
        "media_url": row["media_url"],
        "content_type": row["content_type"],
        "filename": row["filename"],
        "size_bytes": int(row["size_bytes"] or 0),
        "uploaded_by_user_id": row["uploaded_by_user_id"],
        "uploaded_by_name": row["uploaded_by_name"],
        "created_at": created_at.isoformat().replace("+00:00", "Z"),
        "use_count": int(row["use_count"] or 0),
        "ai_description": row["ai_description"],
    }

def validated_media_filename(filename: str, current_filename: str) -> str:
    normalized = filename.strip()
    if not normalized or len(normalized) > 255:
        raise ValueError("El nombre debe tener entre 1 y 255 caracteres")
    if normalized in {".", ".."} or "/" in normalized or "\\" in normalized:
        raise ValueError("El nombre no puede contener rutas")
    if any(ord(character) < 32 for character in normalized):
        raise ValueError("El nombre contiene caracteres no permitidos")
    if Path(normalized).suffix.lower() != Path(current_filename).suffix.lower():
        raise ValueError("Conserva la extensión original del archivo")
    return normalized
