"""Paquete inicial "Clínica estética" para un negocio recién creado.

Un negocio nuevo llegaba vacío: sin etiquetas, sin plantillas para el
autocompletado ``/`` del chat y sin automatizaciones de ejemplo, y el admin
tenía que inventarlas antes de poder atender. El paquete deja una base
razonable que el negocio edita o borra.

- Las etapas del embudo no van acá: las siembra la migración
  ``d9e2a4c7f1b5`` en todo schema (con ``kind`` open/won/lost, incluidas
  ``perdido``, ``descalificado`` y ``baja`` como salidas del embudo), y sus
  claves son las que usa el analista de n8n.
- Es aditivo e idempotente: cada dueño inserta solo lo que falta y nunca
  modifica lo existente. Las automatizaciones se reconocen por nombre.
- Las automatizaciones nacen **desactivadas**: mandan mensajes de WhatsApp en
  nombre del negocio y eso lo decide el admin, no el alta.
- Se aplica solo en el alta de un negocio nuevo (``provision_tenant``);
  a uno existente únicamente si el operador lo pide desde la plataforma.
"""

from __future__ import annotations

import logging

from app.modules.auth.public import team_summary
from app.modules.automations.public import (
    create_automation_rule,
    list_automation_rules,
    validate_automation_rule,
)
from app.modules.catalogs.public import seed_starter_catalog


logger = logging.getLogger(__name__)

STARTER_PACK_NAME = "Clínica estética"

STARTER_TAGS: tuple[dict, ...] = (
    {"name": "Primera consulta", "color": "#0ea5e9"},
    {"name": "Paciente recurrente", "color": "#16a34a"},
    {"name": "Pidió precio", "color": "#f59e0b"},
    {"name": "Interesado en paquete", "color": "#8b5cf6"},
    {"name": "Vino por anuncio", "color": "#ec4899"},
    {"name": "Sin respuesta", "color": "#64748b"},
)

# "General" y "Seguimiento" ya las siembra la migración f8a4d1c72e90; van
# igual para no depender de eso.
STARTER_TEMPLATE_CATEGORIES: tuple[str, ...] = ("General", "Seguimiento", "Bienvenida", "Citas", "Ventas")

# Atajos cortos y en minúsculas: son los que el vendedor escribe después de
# "/" en el chat. Solo variables que el CRM sabe completar.
STARTER_TEMPLATES: tuple[dict, ...] = (
    {
        "name": "Saludo inicial",
        "shortcut": "hola",
        "category": "Bienvenida",
        "content": (
            "Hola {{nombre}}, gracias por escribirnos. Soy {{vendedor}} y te voy a "
            "ayudar. ¿Qué tratamiento te interesa o qué te gustaría mejorar?"
        ),
    },
    {
        "name": "Pedir datos para agendar",
        "shortcut": "datos",
        "category": "Citas",
        "content": (
            "Para reservar tu cita necesito tu nombre completo, tu DNI y el día y "
            "horario que te quedan mejor."
        ),
    },
    {
        "name": "Precio del tratamiento",
        "shortcut": "precio",
        "category": "Ventas",
        "content": (
            "El tratamiento de {{servicio}} se evalúa en una consulta para darte el "
            "precio exacto según lo que necesitas. ¿Te agendo una evaluación?"
        ),
    },
    {
        "name": "Ubicación y horarios",
        "shortcut": "ubicacion",
        "category": "General",
        "content": (
            "Te comparto nuestra dirección y horarios de atención. Si quieres, te "
            "agendo de una vez en el horario que prefieras."
        ),
    },
    {
        "name": "Confirmar cita",
        "shortcut": "confirmar",
        "category": "Citas",
        "content": (
            "Hola {{nombre}}, te escribimos para confirmar tu cita. ¿Nos confirmas "
            "tu asistencia respondiendo SÍ?"
        ),
    },
    {
        "name": "Seguimiento sin respuesta",
        "shortcut": "seguimiento",
        "category": "Seguimiento",
        "content": (
            "Hola {{nombre}}, ¿pudiste revisar la información que te enviamos? "
            "Quedo atenta a cualquier duda."
        ),
    },
    {
        "name": "Agradecimiento post tratamiento",
        "shortcut": "gracias",
        "category": "Seguimiento",
        "content": (
            "Gracias por visitarnos, {{nombre}}. ¿Cómo te sentiste después del "
            "tratamiento? Cualquier consulta, escríbenos por aquí."
        ),
    },
)

STARTER_SHORTCUTS = frozenset(template["shortcut"] for template in STARTER_TEMPLATES)

STARTER_AUTOMATIONS: tuple[dict, ...] = (
    {
        "name": "Bienvenida a leads nuevos",
        "trigger_type": "lead_created",
        "trigger_config": {},
        "conditions": {},
        "actions": [
            {
                "type": "send_message",
                "text": (
                    "Hola {{nombre}}, gracias por escribirnos. En un momento te "
                    "atiende una asesora."
                ),
            },
        ],
        "delay_minutes": 0,
        "is_active": False,
    },
    {
        "name": "Recordatorio de cita",
        "trigger_type": "stage_changed",
        "trigger_config": {},
        "conditions": {"stage": "agendado"},
        "actions": [
            {
                "type": "send_message",
                "text": (
                    "Hola {{nombre}}, tu cita quedó agendada. Te escribiremos antes "
                    "para confirmar tu asistencia."
                ),
            },
            {
                "type": "create_task",
                "title": "Confirmar asistencia a la cita",
                "task_type": "cita",
                "priority": "normal",
                "due_minutes": 1440,
                "remind_minutes_before": 60,
            },
        ],
        "delay_minutes": 0,
        "is_active": False,
    },
    {
        "name": "Recuperar a quien no responde",
        "trigger_type": "customer_response_overdue",
        "trigger_config": {"minutes": 1440},
        # Fuera de la ventana de 24 h Meta solo acepta plantillas oficiales:
        # sin esta condición la ejecución fallaría en vez de saltarse.
        "conditions": {"require_open_window": True},
        "actions": [
            {
                "type": "send_message",
                "text": (
                    "Hola {{nombre}}, ¿pudiste revisar la información que te "
                    "enviamos? Si tienes alguna duda, aquí estamos."
                ),
            },
        ],
        "delay_minutes": 0,
        "is_active": False,
    },
)


async def _seed_automations(user_id: int) -> int:
    existing = {str(rule["name"]).strip().lower() for rule in await list_automation_rules()}
    created = 0
    for raw in STARTER_AUTOMATIONS:
        if raw["name"].strip().lower() in existing:
            continue
        values = await validate_automation_rule(dict(raw))
        await create_automation_rule(values, user_id)
        created += 1
    return created


async def apply_starter_pack() -> dict[str, int]:
    """Siembra el paquete en el tenant del contexto actual.

    Devuelve cuántas filas agregó de cada cosa; todo en cero significa que el
    negocio ya lo tenía. Sin un admin activo solo se siembran etiquetas y
    categorías (plantillas y reglas exigen autor).
    """

    team = await team_summary()
    user_id = team["first_admin_id"]
    created = await seed_starter_catalog(
        tags=[dict(tag) for tag in STARTER_TAGS],
        categories=list(STARTER_TEMPLATE_CATEGORIES),
        templates=[dict(template) for template in STARTER_TEMPLATES],
        user_id=user_id,
    )
    created["automations"] = await _seed_automations(user_id) if user_id else 0
    created["needs_admin"] = 0 if user_id else 1
    logger.info("Paquete inicial %s aplicado: %s", STARTER_PACK_NAME, created)
    return created
