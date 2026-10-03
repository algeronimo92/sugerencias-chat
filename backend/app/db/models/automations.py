"""Modelos ORM del dominio automations."""

from datetime import datetime
from sqlalchemy import BigInteger, Boolean, CheckConstraint, DateTime, ForeignKey, Index, Integer, Text, text
from sqlalchemy.dialects.postgresql import JSONB, UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column
from app.modules.automations.ports.types import AutomationBuilderMode, AutomationExecutionStatus
from app.db.base import Base


class AutomationRule(Base):
    __tablename__ = "automation_rules"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(Text)
    trigger_type: Mapped[str] = mapped_column(Text)
    trigger_config: Mapped[dict] = mapped_column(JSONB, default=dict, server_default="{}")
    conditions: Mapped[dict] = mapped_column(JSONB, default=dict, server_default="{}")
    actions: Mapped[list] = mapped_column(JSONB, default=list, server_default="[]")
    builder_mode: Mapped[str] = mapped_column(
        Text,
        default=AutomationBuilderMode.SIMPLE,
        server_default=AutomationBuilderMode.SIMPLE.value,
    )
    flow_definition: Mapped[dict] = mapped_column(JSONB, default=dict, server_default="{}")
    published_flow_definition: Mapped[dict | None] = mapped_column(JSONB)
    flow_version: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    delay_minutes: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    # Tope de seguridad: si se completan >= N ejecuciones en la última hora,
    # las siguientes se re-agendan para más tarde en vez de correr — protege
    # contra un bug o una condición mal armada que dispare de más y arriesgue
    # el número de WhatsApp por spam. None = sin límite.
    max_executions_per_hour: Mapped[int | None] = mapped_column(Integer)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    # Solo aplica a flujos visuales con trigger_type=manual: si está en True,
    # el flujo aparece en el selector "Iniciar flujo" del vendedor dentro del
    # chat. El admin siempre puede dispararlo aunque esté en False.
    visible_to_sellers: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_by_user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

    __table_args__ = (
        Index("idx_automation_rules_trigger_active", trigger_type, is_active),
        Index("idx_automation_rules_builder_mode", builder_mode, is_active),
        Index("idx_automation_rules_created_by", created_by_user_id),
    )


class AutomationFlowVersion(Base):
    """Definición publicada de un flujo visual, una fila por versión. Las
    ejecuciones guardan (rule_id, flow_version) en flow_state y resuelven la
    definición acá — así una ejecución con esperas termina con la versión con
    la que arrancó aunque el flujo se republique."""

    __tablename__ = "automation_flow_versions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    rule_id: Mapped[int] = mapped_column(ForeignKey("automation_rules.id", ondelete="CASCADE"))
    version: Mapped[int] = mapped_column(Integer)
    definition: Mapped[dict] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

    __table_args__ = (
        Index("uq_automation_flow_versions_rule_version", rule_id, version, unique=True),
    )


class AutomationRoundRobinState(Base):
    """Turno actual de cada bloque Round robin, una fila por (regla, bloque).

    El reparto es global del bloque, no por lead: la ejecución número N sale
    por `outputs[N % cantidad_de_salidas]`, así los leads se distribuyen en
    partes iguales entre las salidas. Vive fuera de automation_executions
    porque el contador tiene que sobrevivir a cada ejecución y avanzar de a
    uno aunque varias corran en paralelo (UPDATE atómico con RETURNING).
    """

    __tablename__ = "automation_round_robin_state"

    rule_id: Mapped[int] = mapped_column(
        ForeignKey("automation_rules.id", ondelete="CASCADE"), primary_key=True,
    )
    node_id: Mapped[str] = mapped_column(Text, primary_key=True)
    counter: Mapped[int] = mapped_column(BigInteger, default=0, server_default="0")
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class AutomationExecution(Base):
    __tablename__ = "automation_executions"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    rule_id: Mapped[int] = mapped_column(ForeignKey("automation_rules.id", ondelete="CASCADE"))
    lead_id: Mapped[str | None] = mapped_column(PG_UUID(as_uuid=False), ForeignKey("leads.id", ondelete="SET NULL"))
    trigger_type: Mapped[str] = mapped_column(Text)
    event_key: Mapped[str] = mapped_column(Text)
    event_payload: Mapped[dict] = mapped_column(JSONB, default=dict, server_default="{}")
    status: Mapped[str] = mapped_column(
        Text,
        default=AutomationExecutionStatus.SCHEDULED,
        server_default=AutomationExecutionStatus.SCHEDULED.value,
    )
    attempts: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    scheduled_for: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    # Momento en que la ejecución quedó congelada por la pausa del lead. Con
    # scheduled_for intacto alcanza para devolverle al reanudar exactamente el
    # tiempo que le faltaba: scheduled_for += (ahora - paused_at).
    paused_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Quién congeló esta ejecución: 'lead' si fue pausar el lead entero (el
    # botón del bot en la cabecera del chat), 'execution' si el vendedor pausó
    # solo esta desde el panel de automatizaciones. Reanudar el lead no
    # descongela las de alcance 'execution'. NULL es lo que dejaron las pausas
    # anteriores a la columna y se lee como 'lead'.
    pause_scope: Mapped[str | None] = mapped_column(Text)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    action_results: Mapped[list] = mapped_column(JSONB, default=list, server_default="[]")
    flow_state: Mapped[dict] = mapped_column(JSONB, default=dict, server_default="{}")
    error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    # Quién y cómo arrancó esta ejecución: 'system' para todos los triggers
    # automáticos de siempre, 'manual' cuando la inicia un vendedor con el
    # botón "Iniciar flujo" del chat. started_by_user_id solo se llena en el
    # caso manual. 'flow' identifica una ejecución creada por otro flujo.
    start_source: Mapped[str] = mapped_column(Text, default="system", server_default="system")
    started_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    # Un admin autorizó a ESTA ejecución a enviar con la ventana de atención
    # de 24 h cerrada, desde la alerta del fallo. Es puntual y auditado: la
    # próxima ejecución de la misma regla vuelve a respetar la ventana.
    window_override_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    window_override_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    __table_args__ = (
        Index("uq_automation_execution_rule_event", rule_id, event_key, unique=True),
        Index("idx_automation_executions_due", status, scheduled_for),
        Index("idx_automation_executions_rule_created", rule_id, created_at.desc()),
        Index("idx_automation_executions_lead_created", lead_id, created_at.desc()),
        # Un solo flujo manual activo (scheduled/running/paused) por lead — el
        # vendedor puede repetirlo una vez que el anterior llegó a un estado
        # terminal. Una congelada a mano sigue contando: si no, el vendedor
        # podría arrancar una segunda y terminar con las dos en paralelo al
        # reanudar. Los triggers de sistema no entran acá: ya dedupan por
        # event_key fijo.
        Index(
            "uq_automation_executions_manual_active_per_lead",
            rule_id, lead_id,
            unique=True,
            postgresql_where=text(
                "start_source = 'manual' AND status IN ('scheduled', 'running', 'paused')"
            ),
        ),
        # Flujos que disparó un vendedor en el período: el eje del dashboard
        # de vendedores. Parcial porque started_by_user_id solo se llena en los
        # disparos manuales, una fracción de las ejecuciones.
        Index(
            "idx_automation_executions_starter_created",
            started_by_user_id,
            created_at.desc(),
            postgresql_where=text("started_by_user_id IS NOT NULL"),
        ),
        CheckConstraint(
            "start_source IN ('system', 'manual', 'flow')",
            name="ck_automation_executions_start_source",
        ),
    )
