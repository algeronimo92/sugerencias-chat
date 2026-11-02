"""Semántica y forma de las etapas del embudo."""

from enum import StrEnum


class LeadStageKind(StrEnum):
    """Semántica de una etapa del embudo, independiente de su nombre.

    Las etapas son filas por negocio (``lead_stages``): el código nunca
    decide por la clave ni por el nombre visible, sino por esto. Una etapa
    ``LOST`` pide y guarda la razón de pérdida al entrar y la limpia al
    salir hacia una etapa que no lo es.
    """

    OPEN = "open"
    WON = "won"
    LOST = "lost"


# Etapa en la que nace todo lead. Es la única clave que el código fija: la
# base impide desactivarla (lead_stages_initial_active_check) y la API
# impide borrarla. El resto de las claves las define cada negocio.
INITIAL_LEAD_STAGE = "nuevo"


# Clave estable de una etapa: la guardan leads.estado, las automatizaciones,
# las plantillas y el historial, así que no cambia al renombrar la etapa.
LEAD_STAGE_KEY_PATTERN = r"^[a-z][a-z0-9_]{0,39}$"
