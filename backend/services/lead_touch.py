from datetime import datetime

from sqlalchemy import update

from db.models import Lead


def touch_last_read_stmt(chat_id: str, when: datetime):
    """Statement para marcar el chat visto por un humano. Se ejecuta dentro
    de la transacción del llamador (insert_message, enqueue_messages) o de
    la propia de mark_chat_read — no abre sesión, solo arma el UPDATE."""
    return update(Lead).where(Lead.id == chat_id).values(last_read_at=when)


def touch_automated_reply_stmt(chat_id: str, when: datetime):
    """Statement para registrar que un bot/automatización (sin actor_user_id
    humano) le respondió al lead — no cuenta como que un vendedor lo vio."""
    return update(Lead).where(Lead.id == chat_id).values(last_automated_reply_at=when)


def touch_ultimo_mensaje_stmt(chat_id: str, when: datetime):
    """Statement para actualizar ``ultimo_mensaje_at`` en cada mensaje. Se
    ejecuta dentro de la transacción de ``insert_message`` a propósito, en
    vez de llamar a ``update_lead``: ese helper abre su propia sesión y hace
    ``SELECT ... FOR UPDATE`` sobre ``leads``, lo que compite con el `UPDATE`
    de ``touch_last_read_stmt``/``touch_automated_reply_stmt`` de la misma
    transacción (deadlock en cada mensaje saliente de un vendedor) y además
    registra un evento "lead_updated" en el historial por cada mensaje."""
    return update(Lead).where(Lead.id == chat_id).values(ultimo_mensaje_at=when)
