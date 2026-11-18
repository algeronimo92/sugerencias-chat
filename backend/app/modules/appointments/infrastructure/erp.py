"""Los conectores del envío de citas al ERP: el propio ERP, los paquetes del
catálogo sincronizado y dónde se guarda el comprobante del adelanto."""

from __future__ import annotations

import asyncio
import logging

from app.integrations.erp_appointments import ping, post_appointment
from app.integrations.storage.media_storage import read_media_bytes, stat_media
from app.modules.appointments.domain.erp_push import (
    ERP_NOT_CONFIGURED,
    Receipt,
    erp_appointment_link,
    erp_error,
)
from app.modules.catalogs.ports.service_packages import sellable_packages
from app.modules.media.ports.media_upload import save_decoded_media
from app.modules.platform.ports.settings_service import get_effective_many, update_settings
from app.tenancy.context import get_current_tenant

logger = logging.getLogger(__name__)

ENABLED_KEY = "erp_appointments_enabled"
URL_KEY = "erp_appointments_url"
TOKEN_KEY = "erp_appointments_token"
# Los paquetes que se le mandan al ERP salen del catálogo que se sincroniza
# desde él: sin esa sincronización no hay con qué armar la cita.
CATALOG_KEY = "erp_catalog_url"


class ErpAppointmentsGateway:
    async def _settings(self) -> dict[str, str]:
        return await get_effective_many((ENABLED_KEY, URL_KEY, TOKEN_KEY, CATALOG_KEY))

    @staticmethod
    def _ready(settings: dict[str, str]) -> bool:
        return (
            settings[ENABLED_KEY].strip().lower() == "true"
            and bool(settings[URL_KEY] and settings[TOKEN_KEY] and settings[CATALOG_KEY])
        )

    async def active(self) -> bool:
        return self._ready(await self._settings())

    async def config(self) -> dict:
        settings = await self._settings()
        return {
            "enabled": settings[ENABLED_KEY].strip().lower() == "true",
            "url": settings[URL_KEY],
            "token_configured": bool(settings[TOKEN_KEY]),
            "catalog_connected": bool(settings[CATALOG_KEY]),
        }

    async def save_config(self, *, enabled: bool, url: str, token: str | None) -> None:
        values = {ENABLED_KEY: "true" if enabled else "false", URL_KEY: url}
        if token is not None:
            values[TOKEN_KEY] = token
        await update_settings(values)

    async def external_id(self, appointment_id: int) -> str:
        # Los ids de cita se repiten entre negocios (un schema por negocio):
        # con el negocio delante, dos CRM apuntando al mismo ERP no chocan.
        tenant = get_current_tenant()
        return f"{tenant.organization_id}:{appointment_id}" if tenant else str(appointment_id)

    async def push(self, form: dict[str, str], receipt: Receipt | None) -> dict:
        settings = await self._settings()
        if not self._ready(settings):
            return dict(ERP_NOT_CONFIGURED)
        reply = await post_appointment(
            settings[URL_KEY], settings[TOKEN_KEY], form,
            (receipt.filename, receipt.content, receipt.content_type) if receipt else None,
        )
        if not reply.ok:
            return erp_error(reply.error or "El ERP no aceptó la cita")
        return {
            "status": "synced",
            "erp_appointment_id": reply.appointment_id,
            "erp_link": erp_appointment_link(settings[URL_KEY], reply.appointment_id),
            "error": None,
        }

    async def ping(self, url: str | None, token: str | None) -> dict:
        settings = await self._settings()
        url = (url or "").strip() or settings[URL_KEY]
        token = (token or "").strip() or settings[TOKEN_KEY]
        if not url or not token:
            return {"ok": False, "error": "Faltan la dirección del ERP y el token"}
        reply = await ping(url, token)
        return {"ok": reply.ok, "error": reply.error}


class CatalogPackages:
    async def packages(self, service_name: str) -> list[dict]:
        return await sellable_packages(service_name)


class MediaReceiptStore:
    """El comprobante va al mismo almacenamiento que el resto de archivos del
    negocio. Guardarlo o leerlo no puede tumbar el alta ni el reintento."""

    async def save(self, receipt: Receipt) -> str | None:
        try:
            return await asyncio.to_thread(
                save_decoded_media, receipt.content_type, receipt.content, receipt.filename,
            )
        except Exception:
            logger.exception("No se pudo guardar el comprobante de la cita")
            return None

    async def load(self, url: str, filename: str | None) -> Receipt | None:
        try:
            info = await asyncio.to_thread(stat_media, url)
            content = await asyncio.to_thread(read_media_bytes, url)
        except Exception:
            logger.warning("No se pudo leer el comprobante guardado de la cita", exc_info=True)
            return None
        return Receipt(filename or url.rsplit("/", 1)[-1], content, info.content_type)
