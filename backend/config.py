from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    database_url: str
    n8n_webhook_url: str = ""
    n8n_webhook_token: str = ""
    inbound_webhook_token: str = ""
    evolution_api_url: str = ""
    evolution_api_key: str = ""
    evolution_instance: str = ""
    openai_api_key: str = ""
    openai_tts_model: str = "gpt-4o-mini-tts"
    openai_tts_voice: str = "alloy"
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
