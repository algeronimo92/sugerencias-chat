from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    database_url: str
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
    access_token_expire_hours: int = 24
    # Solo se usan para crear el primer admin cuando la tabla users está
    # vacía (ver services/db_service.py:seed_admin_if_needed). Una vez que
    # existe algún usuario, estas dos variables ya no se leen más.
    admin_email: str = ""
    admin_password: str = ""

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")


settings = Settings()
