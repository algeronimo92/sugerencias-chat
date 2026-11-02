"""Quién mandó cada mensaje saliente.

`sender` solo distingue cliente de vendedor, y con eso "cuántos mensajes mandé"
no se podía responder en un chat que atienden varias personas. La columna
`sent_by_user_id` la llenan los envíos que salen de la app; un envío de
automatización y un eco del celular del vendedor la dejan en NULL, y esa
diferencia es justamente lo que el dashboard cuenta.
"""

from app.modules.conversations.application.outbound import queue_messages
from app.modules.conversations.application.scheduling import dispatch_scheduled_message
from app.modules.conversations.ports.types import ScheduledMessageStatus


def _text(body: str) -> dict:
    return {"message": {"type": "text", "text": {"body": body}}, "content": body}


def _authors(world) -> list[int | None]:
    return [message["sent_by_user_id"] for message in world.outbox.queued]


async def test_a_send_from_the_app_records_its_author(in_memory_conversations):
    await queue_messages("lead-1", [_text("Hola")], actor_user_id=7)

    assert _authors(in_memory_conversations) == [7]
    assert in_memory_conversations.inbox.touches == [("human", "lead-1")]


async def test_an_automation_send_has_no_author(in_memory_conversations):
    """Sin actor no hay persona a quien acreditarlo: el mensaje es del bot y el
    dashboard no debe contarlo como trabajo de nadie."""
    await queue_messages("lead-1", [_text("Recordatorio")])

    assert _authors(in_memory_conversations) == [None]
    assert in_memory_conversations.inbox.touches == [("bot", "lead-1")]


async def test_every_message_of_a_batch_carries_the_author(in_memory_conversations):
    await queue_messages("lead-1", [_text("Uno"), _text("Dos")], actor_user_id=11)

    assert _authors(in_memory_conversations) == [11, 11]


async def test_an_explicit_author_does_not_count_as_a_human_seeing_the_chat(in_memory_conversations):
    """El autor acredita el mensaje; el actor decide el touch. Un programado
    tiene autor pero nadie lo está mirando, así que sigue siendo "atendido por
    bot"."""
    await queue_messages("lead-1", [_text("Hola")], author_user_id=9)

    assert _authors(in_memory_conversations) == [9]
    assert in_memory_conversations.inbox.touches == [("bot", "lead-1")]


async def test_a_scheduled_message_belongs_to_whoever_scheduled_it(in_memory_conversations):
    """Nadie estaba mirando la app cuando salió, pero el mensaje es obra de quien
    lo programó."""
    in_memory_conversations.scheduled.rows[1] = {
        "id": 1, "lead_id": "lead-1", "text": "Hola", "status": ScheduledMessageStatus.PROCESSING,
        "created_by_user_id": 9,
    }

    await dispatch_scheduled_message(1)

    [queued] = in_memory_conversations.outbox.queued
    assert queued["sent_by_user_id"] == 9
    assert queued["job"]["actor_user_id"] is None
