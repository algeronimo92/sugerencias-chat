"""Contratos HTTP de media."""

from pydantic import BaseModel, Field


class MediaAssetCreate(BaseModel):
    content_type: str
    data_base64: str
    filename: str


class MediaAssetUpdate(BaseModel):
    filename: str = Field(min_length=1, max_length=255)


class MediaAssetItem(BaseModel):
    id: int
    media_url: str
    content_type: str
    filename: str
    size_bytes: int
    uploaded_by_user_id: int | None = None
    uploaded_by_name: str | None = None
    created_at: str
    use_count: int = 0
    ai_description: str | None = None



class MediaUpload(BaseModel):
    content_type: str
    data_base64: str



class ImportStickerBody(BaseModel):
    # media_url de un sticker que aparece en un chat.
    media_url: str
