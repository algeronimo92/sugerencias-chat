from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    database_url: str
    # Modo TLS de asyncpg hacia PostgreSQL. La base es externa, así que hoy
    # las credenciales y el contenido de los mensajes cruzan Internet en claro.
    #
    # El default NO puede ser "require" todavía: el servidor actual rechaza el
    # upgrade a SSL ("rejected SSL upgrade"), o sea que tiene ssl=off en su
    # postgresql.conf. Exigirlo dejaría el backend sin arrancar. "prefer"
    # intenta cifrar y cae a claro, así que empieza a cifrar solo en cuanto se
    # habilite TLS en el servidor, sin tocar la aplicación.
    #
    # Cuando el servidor tenga TLS, subir esto a "require" (y a "verify-full"
    # con la CA disponible). El arranque avisa por log si la conexión terminó
    # sin cifrar — ver _log_database_encryption en main.py.
    # Valores: disable | allow | prefer | require | verify-ca | verify-full
    database_ssl: str = "prefer"
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
    # Código de país (sin +) que se antepone a teléfonos tipeados en formato
    # local al crear/editar leads. Editable desde Configuración (app_settings).
    default_country_code: str = "51"
    # Reparte por turnos (round robin) los leads nuevos que llegan por WhatsApp
    # entre los vendedores activos. Editable desde Configuración.
    auto_assign_leads_enabled: str = "false"
    cors_origins: list[str] = ["http://localhost:5173", "http://localhost:3000"]

    # Almacenamiento multimedia. "local" conserva el comportamiento anterior;
    # "minio" usa un bucket privado y mantiene las URLs /media/<archivo>.
    media_storage_backend: str = "local"
    minio_endpoint: str = ""
    minio_access_key: str = ""
    minio_secret_key: str = ""
    minio_bucket: str = ""
    minio_region: str = "us-east-1"
    minio_secure: bool = True
    minio_verify_tls: bool = True
    minio_prefix: str = "dermicapro"

    # Marca `Secure` de la cookie de sesión. None = deducirla del esquema real
    # de la petición (incluyendo X-Forwarded-Proto de Traefik). Detrás del
    # proxy, uvicorn ve http, así que sin este override la cookie salía sin
    # `Secure` en producción. Poner COOKIE_SECURE=true la fuerza.
    cookie_secure: bool | None = None

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
