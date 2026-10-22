def mediatype_from_content_type(content_type: str) -> str:
    """Raíz de Meta para un adjunto según su content type."""
    if content_type.startswith("image/"):
        return "image"
    if content_type.startswith("video/"):
        return "video"
    if content_type.startswith("audio/"):
        return "audio"
    return "document"
