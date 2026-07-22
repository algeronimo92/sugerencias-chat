"""Migra los archivos de backend/media a MinIO sin borrar los originales.

Ejemplos:
    python migrate_media_to_minio.py --dry-run
    python migrate_media_to_minio.py --report media-migration-report.json
    python migrate_media_to_minio.py --overwrite
"""

from __future__ import annotations

import argparse
import json
import mimetypes
import sys
from datetime import datetime, timezone
from pathlib import Path

from services.media_storage import (
    MEDIA_DIR,
    MediaStorageError,
    check_media_storage,
    storage_backend,
    upload_local_file_to_minio,
)


def _arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="Solo cuenta archivos; no conecta ni sube")
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="Reemplaza objetos existentes cuando tamaño o checksum no coinciden",
    )
    parser.add_argument("--report", type=Path, help="Guarda un informe JSON de auditoría")
    return parser.parse_args()


def main() -> int:
    args = _arguments()
    files = sorted(path for path in MEDIA_DIR.iterdir() if path.is_file())
    total_bytes = sum(path.stat().st_size for path in files)
    print(f"Archivos locales: {len(files)} ({total_bytes / 1024 / 1024:.2f} MiB)")
    if args.dry_run:
        return 0

    if storage_backend() != "minio":
        print("Error: configura MEDIA_STORAGE_BACKEND=minio antes de migrar", file=sys.stderr)
        return 2
    try:
        status = check_media_storage()
    except MediaStorageError as exc:
        print(f"Error de conexión: {exc}", file=sys.stderr)
        return 2
    print(f"Destino: {status['backend']} (bucket disponible)")

    results: list[dict] = []
    counts = {"uploaded": 0, "verified": 0, "same-size": 0, "failed": 0}
    for index, path in enumerate(files, start=1):
        content_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        try:
            result = upload_local_file_to_minio(path, content_type, overwrite=args.overwrite)
            counts[result] += 1
            error = None
        except Exception as exc:
            result = "failed"
            counts[result] += 1
            error = str(exc)
        results.append({
            "filename": path.name,
            "size_bytes": path.stat().st_size,
            "content_type": content_type,
            "result": result,
            "error": error,
        })
        print(f"[{index}/{len(files)}] {path.name}: {result}")

    report = {
        "created_at": datetime.now(timezone.utc).isoformat(),
        "source": str(MEDIA_DIR),
        "total_files": len(files),
        "total_bytes": total_bytes,
        "summary": counts,
        "files": results,
    }
    if args.report:
        args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"Informe: {args.report.resolve()}")
    print("Resumen: " + ", ".join(f"{key}={value}" for key, value in counts.items()))
    return 1 if counts["failed"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
