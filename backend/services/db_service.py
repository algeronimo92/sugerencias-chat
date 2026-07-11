import re
from datetime import datetime, timezone

from sqlalchemy import and_, func, insert, or_, select, true, update
from sqlalchemy.exc import IntegrityError

from db.models import Lead, User, WspMessage
from db.session import get_sessionmaker

CHATS_PAGE_SIZE = 30


class LeadAlreadyExistsError(Exception):
    pass


class EmailAlreadyExistsError(Exception):
    pass


class LastAdminError(Exception):
    """Se levanta al intentar desactivar/degradar al único admin activo."""

    pass


def _fmt_ts(value: datetime | None) -> str | None:
    # Microsegundos incluidos: la paginación por cursor usa este mismo valor
    # de ida y vuelta, y truncarlo a segundos podía generar colisiones falsas.
    return value.strftime('%Y-%m-%dT%H:%M:%S.%fZ') if value else None


def _phone_to_jid(phone: str) -> str:
    digits = re.sub(r"\D", "", phone)
    return f"{digits}@s.whatsapp.net"


def _row_to_chat(row) -> dict:
    return {
        "chat_id": row["chat_id"],
        "phone": row["phone"],
        "name": row["name"],
        "servicio_interes": row["servicio_interes"],
        "vendedor": row["vendedor"],
        "origen": row["origen"],
        "notas": row["notas"],
        "last_message": row["last_message"],
        "last_message_sender": row["last_message_sender"],
        "timestamp": _fmt_ts(row["timestamp"]),
    }


def _parse_ts(value: str) -> datetime:
    return datetime.strptime(value, '%Y-%m-%dT%H:%M:%S.%fZ').replace(tzinfo=timezone.utc)


def _last_message_subquery():
    """Último mensaje por chat vía LATERAL JOIN, evita un N+1 por lead.
    Incluye sender: el frontend lo usa para saber si el chat quedó
    "esperando respuesta" (último mensaje del cliente) o no (vendedor)."""
    return (
        select(WspMessage.content, WspMessage.sent_at, WspMessage.sender)
        .where(WspMessage.chat_id == Lead.remote_jid)
        .order_by(WspMessage.sent_at.desc())
        .limit(1)
        .lateral()
    )


def _cursor_condition(last_message, cursor_ts: str | None, cursor_id: str):
    """Condición de paginación por keyset sobre el mismo orden de la consulta
    (last_message.sent_at DESC NULLS LAST, remote_jid DESC).

    cursor_ts/cursor_id identifican la última fila de la página anterior;
    se piden las filas que la siguen en ese orden. A diferencia de OFFSET,
    esto no se desalinea si un chat sube al tope por un mensaje nuevo entre
    una página y la siguiente.
    """
    if cursor_ts is not None:
        parsed_ts = _parse_ts(cursor_ts)
        return or_(
            last_message.c.sent_at < parsed_ts,
            and_(last_message.c.sent_at == parsed_ts, Lead.remote_jid < cursor_id),
            last_message.c.sent_at.is_(None),
        )
    # La fila cursor ya estaba en la cola de timestamp nulo: solo quedan
    # otras filas sin mensajes, desempatadas por remote_jid.
    return and_(last_message.c.sent_at.is_(None), Lead.remote_jid < cursor_id)


async def fetch_chats(
    search: str | None = None,
    cursor_ts: str | None = None,
    cursor_id: str | None = None,
    limit: int = CHATS_PAGE_SIZE,
) -> dict:
    last_message = _last_message_subquery()

    stmt = (
        select(
            Lead.remote_jid.label("chat_id"),
            Lead.telefono.label("phone"),
            Lead.nombre.label("name"),
            Lead.servicio_interes,
            Lead.vendedor,
            Lead.origen,
            Lead.notas,
            last_message.c.content.label("last_message"),
            last_message.c.sender.label("last_message_sender"),
            last_message.c.sent_at.label("timestamp"),
        )
        .join(last_message, true(), isouter=True)
    )

    if search:
        pattern = f"%{search}%"
        stmt = stmt.where(
            or_(
                Lead.remote_jid.ilike(pattern),
                Lead.telefono.ilike(pattern),
                Lead.nombre.ilike(pattern),
                last_message.c.content.ilike(pattern),
            )
        )

    if cursor_id is not None:
        stmt = stmt.where(_cursor_condition(last_message, cursor_ts, cursor_id))

    # Se pide una fila de más para saber si hay página siguiente sin un
    # COUNT(*) aparte; se descarta antes de devolver los resultados.
    stmt = stmt.order_by(
        last_message.c.sent_at.desc().nulls_last(), Lead.remote_jid.desc()
    ).limit(limit + 1)

    async with get_sessionmaker()() as session:
        rows = (await session.execute(stmt)).mappings().all()

    has_more = len(rows) > limit
    rows = rows[:limit]

    return {"items": [_row_to_chat(r) for r in rows], "has_more": has_more}


async def fetch_chat(chat_id: str) -> dict | None:
    last_message = _last_message_subquery()
    stmt = (
        select(
            Lead.remote_jid.label("chat_id"),
            Lead.telefono.label("phone"),
            Lead.nombre.label("name"),
            Lead.servicio_interes,
            Lead.vendedor,
            Lead.origen,
            Lead.notas,
            last_message.c.content.label("last_message"),
            last_message.c.sender.label("last_message_sender"),
            last_message.c.sent_at.label("timestamp"),
        )
        .join(last_message, true(), isouter=True)
        .where(Lead.remote_jid == chat_id)
    )
    async with get_sessionmaker()() as session:
        row = (await session.execute(stmt)).mappings().first()

    return _row_to_chat(row) if row is not None else None


async def create_lead(
    phone: str,
    name: str,
    servicio_interes: str | None = None,
    vendedor: str | None = None,
    origen: str | None = None,
    notas: str | None = None,
) -> dict:
    chat_id = _phone_to_jid(phone)
    stmt = insert(Lead).values(
        remote_jid=chat_id,
        telefono=phone,
        nombre=name,
        servicio_interes=servicio_interes,
        vendedor=vendedor,
        origen=origen,
        notas=notas,
    )
    async with get_sessionmaker()() as session:
        try:
            await session.execute(stmt)
            await session.commit()
        except IntegrityError:
            await session.rollback()
            raise LeadAlreadyExistsError(chat_id)

    return await fetch_chat(chat_id)


async def update_lead(chat_id: str, values: dict) -> dict | None:
    if not values:
        return await fetch_chat(chat_id)

    stmt = update(Lead).where(Lead.remote_jid == chat_id).values(**values)
    async with get_sessionmaker()() as session:
        result = await session.execute(stmt)
        if result.rowcount == 0:
            return None
        await session.commit()

    return await fetch_chat(chat_id)


async def insert_message(chat_id: str, sender: str, content: str, media_url: str | None = None) -> dict:
    stmt = (
        insert(WspMessage)
        .values(
            chat_id=chat_id,
            sender=sender,
            content=content,
            media_url=media_url,
            sent_at=datetime.now(timezone.utc),
        )
        .returning(
            WspMessage.id, WspMessage.sender, WspMessage.content, WspMessage.sent_at, WspMessage.media_url
        )
    )
    async with get_sessionmaker()() as session:
        row = (await session.execute(stmt)).mappings().one()
        await session.commit()

    return {
        "id": row["id"],
        "sender": row["sender"],
        "content": row["content"],
        "sent_at": _fmt_ts(row["sent_at"]),
        "media_url": row["media_url"],
    }


async def fetch_chat_signature() -> str:
    """Firma liviana del estado de los mensajes, usada para detectar mensajes nuevos como respaldo del webhook."""
    stmt = select(func.count(WspMessage.id), func.max(WspMessage.sent_at))
    async with get_sessionmaker()() as session:
        count, last_sent = (await session.execute(stmt)).one()
    return f"{count}:{last_sent.isoformat() if last_sent else ''}"


async def fetch_messages(chat_id: str) -> list[dict]:
    stmt = (
        select(
            WspMessage.id,
            WspMessage.sender,
            WspMessage.content,
            WspMessage.sent_at,
            WspMessage.media_url,
        )
        .where(WspMessage.chat_id == chat_id)
        .order_by(WspMessage.sent_at.asc())
        .limit(500)
    )

    async with get_sessionmaker()() as session:
        rows = (await session.execute(stmt)).mappings().all()

    return [
        {
            "id": r["id"],
            "sender": r["sender"],
            "content": r["content"],
            "sent_at": _fmt_ts(r["sent_at"]),
            "media_url": r["media_url"],
        }
        for r in rows
    ]


def _row_to_user(user: User) -> dict:
    return {
        "id": user.id,
        "email": user.email,
        "name": user.name,
        "role": user.role,
        "is_active": user.is_active,
    }


async def get_user_by_id(user_id: int) -> User | None:
    async with get_sessionmaker()() as session:
        return await session.get(User, user_id)


async def get_user_by_email(email: str) -> User | None:
    stmt = select(User).where(User.email == email)
    async with get_sessionmaker()() as session:
        return (await session.execute(stmt)).scalar_one_or_none()


async def list_users() -> list[dict]:
    stmt = select(User).order_by(User.created_at.asc())
    async with get_sessionmaker()() as session:
        users = (await session.execute(stmt)).scalars().all()
    return [_row_to_user(u) for u in users]


async def create_user(email: str, name: str, password_hash: str, role: str) -> dict:
    stmt = insert(User).values(
        email=email,
        name=name,
        password_hash=password_hash,
        role=role,
        is_active=True,
        created_at=datetime.now(timezone.utc),
    )
    async with get_sessionmaker()() as session:
        try:
            await session.execute(stmt)
            await session.commit()
        except IntegrityError:
            await session.rollback()
            raise EmailAlreadyExistsError(email)

    user = await get_user_by_email(email)
    return _row_to_user(user)


async def count_active_admins(exclude_user_id: int | None = None) -> int:
    stmt = select(func.count(User.id)).where(User.role == "admin", User.is_active == true())
    if exclude_user_id is not None:
        stmt = stmt.where(User.id != exclude_user_id)
    async with get_sessionmaker()() as session:
        return (await session.execute(stmt)).scalar_one()


async def update_user(user_id: int, values: dict) -> dict | None:
    """values puede traer 'role' y/o 'is_active'. Si el cambio dejaría sin
    ningún admin activo, se rechaza con LastAdminError antes de aplicarlo."""
    demotes_or_deactivates = values.get("role") == "vendedor" or values.get("is_active") is False
    if demotes_or_deactivates:
        user = await get_user_by_id(user_id)
        if user is not None and user.role == "admin" and await count_active_admins(exclude_user_id=user_id) == 0:
            raise LastAdminError()

    if not values:
        user = await get_user_by_id(user_id)
        return _row_to_user(user) if user else None

    stmt = update(User).where(User.id == user_id).values(**values)
    async with get_sessionmaker()() as session:
        result = await session.execute(stmt)
        if result.rowcount == 0:
            return None
        await session.commit()

    user = await get_user_by_id(user_id)
    return _row_to_user(user) if user else None


async def set_user_password(user_id: int, password_hash: str) -> bool:
    stmt = update(User).where(User.id == user_id).values(password_hash=password_hash)
    async with get_sessionmaker()() as session:
        result = await session.execute(stmt)
        await session.commit()
        return result.rowcount > 0


async def seed_admin_if_needed(email: str, password_hash: str) -> None:
    """Crea el primer admin si la tabla users está vacía. No hace nada si ya
    existe algún usuario (aunque ADMIN_EMAIL/ADMIN_PASSWORD sigan en el .env)."""
    async with get_sessionmaker()() as session:
        count = (await session.execute(select(func.count(User.id)))).scalar_one()
    if count > 0:
        return

    await create_user(email=email, name="Admin", password_hash=password_hash, role="admin")
