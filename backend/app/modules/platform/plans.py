"""Paquetes de CliniVentas: qué funciones trae cada uno y con qué topes.

Es la fuente de verdad de lo que se cobra; la página pública
(``landing/src/paquetes.ts``) lo describe en palabras y un test compara las
dos. El reparto salió del debate de producto del 2026-11-14: lo que hace que
el CRM sirva (WhatsApp, embudo, citas, panel, respaldo) va en todos, y se sube
de paquete por tamaño de equipo, por automatizar y por anuncios. Nunca se
cobra por leads, mensajes ni conversaciones.

El catálogo es código y no una tabla: una función nueva necesita su bloqueo
en una ruta, así que llega con un cambio de código de todas formas. Lo que sí
vive en la base es qué paquete tiene cada negocio (``organizations.plan``).
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum


class PlanId(StrEnum):
    BASICO = "basico"
    ESENCIAL = "esencial"
    PROFESIONAL = "profesional"


class Feature(StrEnum):
    """Funciones que no están en todos los paquetes.

    Lo que está en todos no aparece: no hay nada que bloquear.
    """

    AUTO_ASSIGN = "leads.auto_assign"
    CUSTOM_FIELDS = "catalogs.custom_fields"
    NOTICE_SENDER = "appointments.notice_sender"
    REPORTS_EXPORT = "dashboard.reports_export"
    META_CONVERSIONS = "meta.conversions"
    ERP_SYNC = "catalogs.erp_sync"


@dataclass(frozen=True, slots=True)
class PlanSpec:
    id: PlanId
    name: str
    features: frozenset[Feature]
    # Personas que atienden: admin y vendedores, activos o con la invitación
    # pendiente. Las cuentas de solo lectura (analista) no cuentan: van
    # incluidas en todos los paquetes. ``None`` es sin límite.
    max_seats: int | None
    # Automatizaciones encendidas a la vez. Las apagadas no cuentan: así el
    # negocio que baja de paquete conserva todas y elige cuáles dejar activas.
    max_active_automations: int | None
    # Lo que se le pone al negocio al asignarle el paquete. Después la
    # plataforma puede cambiarlo a mano (``organizations.ai_enabled`` /
    # ``ai_monthly_quota``), que es como se da una excepción.
    ai_enabled: bool
    ai_monthly_quota: int | None

    def has(self, feature: Feature) -> bool:
        return feature in self.features


_ESENCIAL_FEATURES = frozenset({
    Feature.AUTO_ASSIGN,
    Feature.CUSTOM_FIELDS,
    Feature.NOTICE_SENDER,
    Feature.REPORTS_EXPORT,
})

PLANS: dict[PlanId, PlanSpec] = {
    PlanId.BASICO: PlanSpec(
        id=PlanId.BASICO,
        name="Básico",
        features=frozenset(),
        max_seats=3,
        max_active_automations=3,
        ai_enabled=False,
        ai_monthly_quota=0,
    ),
    PlanId.ESENCIAL: PlanSpec(
        id=PlanId.ESENCIAL,
        name="Esencial",
        features=_ESENCIAL_FEATURES,
        max_seats=10,
        max_active_automations=None,
        ai_enabled=True,
        ai_monthly_quota=1000,
    ),
    PlanId.PROFESIONAL: PlanSpec(
        id=PlanId.PROFESIONAL,
        name="Profesional",
        features=_ESENCIAL_FEATURES | {Feature.META_CONVERSIONS, Feature.ERP_SYNC},
        max_seats=None,
        max_active_automations=None,
        ai_enabled=True,
        ai_monthly_quota=3000,
    ),
}

# Los negocios que ya existían antes de los paquetes quedan en Profesional:
# nadie pierde una función que ya usaba por una migración.
DEFAULT_PLAN = PlanId.PROFESIONAL


def plan_spec(plan: str | None) -> PlanSpec:
    """El paquete guardado; uno desconocido cae al de por defecto en vez de
    dejar al negocio sin CRM por un valor que no debería existir (la columna
    tiene un CHECK)."""

    try:
        return PLANS[PlanId(plan)] if plan else PLANS[DEFAULT_PLAN]
    except ValueError:
        return PLANS[DEFAULT_PLAN]


FEATURE_LABELS: dict[Feature, str] = {
    Feature.AUTO_ASSIGN: "El reparto automático de leads",
    Feature.CUSTOM_FIELDS: "Los campos propios en la ficha",
    Feature.NOTICE_SENDER: "El número aparte para los avisos de cita",
    Feature.REPORTS_EXPORT: "Los reportes en Excel",
    Feature.META_CONVERSIONS: "Los eventos de conversión a Meta",
    Feature.ERP_SYNC: "Los precios sincronizados con tu sistema",
}


def minimum_plan_for(feature: Feature) -> PlanSpec:
    """El paquete más barato que trae la función, para decirlo en el aviso."""

    for plan_id in (PlanId.BASICO, PlanId.ESENCIAL, PlanId.PROFESIONAL):
        if PLANS[plan_id].has(feature):
            return PLANS[plan_id]
    raise ValueError(f"Ningún paquete incluye {feature}")
