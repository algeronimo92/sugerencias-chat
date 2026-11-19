"""Qué plantilla puede mandar una automatización y con qué valores.

Una regla corre sin nadie mirando: solo acepta plantillas que se arman sin
preguntarle nada a una persona. Las internas sin botones ni lista, y las
oficiales de Meta aprobadas cuyas variables salen todas de la tarjeta del lead.
Las que usan datos de la cita (``{{cita.fecha}}``) quedan afuera: la regla no
sabe de qué cita se trata.

La misma regla vale al guardar (``SqlReferenceChecker``), al ejecutar y al
simular, para que una plantilla que dejó de servir falle con el mismo motivo
en los tres lados.
"""

from __future__ import annotations

import re
from collections.abc import Mapping

from app.modules.automations.domain.rules import CRM_VARIABLES, render_variables
from app.modules.catalogs.ports.template_validation import template_parameter_identifiers
from app.modules.catalogs.ports.types import InteractiveType, TemplateType

META_APPROVED = "APPROVED"

# Mismo patrón que las variables de Plantillas: admite espacios ("{{ nombre }}"),
# que ``render_variables`` no reconoce.
_VARIABLE = re.compile(r"\{\{\s*([^{}]+?)\s*\}\}")


def is_official(template: Mapping) -> bool:
    return template["template_type"] == TemplateType.OFFICIAL


def _parameter_variables(template: Mapping) -> set[str]:
    return {
        name
        for value in template.get("official_parameter_values") or []
        for name in _VARIABLE.findall(str(value))
    }


def automatic_template_problem(template: Mapping | None) -> str | None:
    """Por qué esta plantilla no se puede mandar desde una automatización, o
    ``None`` si se puede."""
    if template is None:
        return "La plantilla ya no existe"
    if not template["is_active"]:
        return "La plantilla está desactivada"
    if not is_official(template):
        if template["interactive_type"] != InteractiveType.NONE:
            return "Las plantillas con botones o lista no se envían desde automatizaciones"
        return None
    if template.get("official_status") != META_APPROVED:
        return "La plantilla de Meta no está aprobada"
    expected = len(template_parameter_identifiers(template.get("content") or ""))
    if len(template.get("official_parameter_values") or []) != expected:
        return "Falta configurar el valor de cada variable de la plantilla de Meta en Plantillas"
    if _parameter_variables(template) - CRM_VARIABLES:
        return "La plantilla de Meta usa datos de la cita, que una automatización no tiene"
    return None


def official_parameters(template: Mapping, chat: dict) -> list[str]:
    """El valor de cada variable de la plantilla oficial para este lead."""
    return [
        render_variables(_VARIABLE.sub(lambda match: f"{{{{{match.group(1)}}}}}", str(value)), chat).strip()
        for value in template.get("official_parameter_values") or []
    ]
