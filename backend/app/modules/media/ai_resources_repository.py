"""Read-only projection owned by this capability, consumed by AI."""
from sqlalchemy import func, select
from app.db.models.media import MediaAsset
from app.db.uow import session_scope

async def list_ai_resource_rows(max_resources: int) -> list[dict]:
    """Archivos de la biblioteca que el negocio describió para el asistente."""

    async with session_scope() as session:
        rows = (
            await session.execute(
                select(
                    MediaAsset.id,
                    MediaAsset.filename,
                    MediaAsset.content_type,
                    MediaAsset.media_url,
                    MediaAsset.ai_description,
                )
                .where(func.length(func.btrim(func.coalesce(MediaAsset.ai_description, ""))) > 0)
                .order_by(MediaAsset.created_at.desc(), MediaAsset.id.desc())
                .limit(max_resources)
            )
        ).mappings().all()
    return list(rows)
