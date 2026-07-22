from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    database_url: str
    # La DB puede estar a cientos de milisegundos. Hacer SELECT 1 antes de
    # cada checkout duplica el costo de todas las consultas; los despliegues
    # que prefieran esa comprobación pueden volver a activarla por env.
    database_pool_pre_ping: bool = False
    database_pool_size: int = 10
    database_max_overflow: int = 20
    database_pool_recycle_seconds: int = 1800
    n8n_webhook_url: str = ""
    n8n_webhook_token: str = ""
    inbound_webhook_token: str = ""
    evolution_api_url: str = ""
    evolution_api_key: str = ""
    evolution_instance: str = ""
    elevenlabs_api_key: str = ""
    elevenlabs_voice_id: str = "JBFqnCBsd6RMkjVDRZzb"
    elevenlabs_model_id: str = "eleven_multilingual_v2"
    elevenlabs_stability: str = "0"
    elevenlabs_style: str = "1"
    elevenlabs_speed: str = "1.2"
    elevenlabs_use_speaker_boost: str = "true"
    cors_origins: list[str] = ["http://localhost:5173", "http://localhost:3000"]

    # Firma de los JWT de sesión — cambiarla invalida todas las sesiones activas.
    secret_key: str
    # Clave maestra opcional para cifrar secretos guardados en app_settings.
    # Debe ser base64-url de 32 bytes. Si falta, se deriva de SECRET_KEY para
    # poder migrar instalaciones existentes sin bloquear el arranque.
    settings_encryption_key: str = ""
    access_token_expire_hours: int = 24
    auth_user_cache_ttl_seconds: float = 15.0
    # Solo se usan para crear el primer admin cuando la tabla users está
    # vacía (ver services/db_service.py:seed_admin_if_needed). Una vez que
    # existe algún usuario, estas dos variables ya no se leen más.
    admin_email: str = ""
    admin_password: str = ""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        protected_namespaces=("model_",),
    )


settings = Settings()
