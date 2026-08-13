"""Diagnostica un chat: qué tiene la base, qué tiene Evolution y bajo qué JID.

Existe porque las dos preguntas no se pueden separar desde la app. Cuando un
chat "no trae mensajes" hay tres causas posibles y se ven igual en pantalla:

1. Evolution nunca recibió los mensajes (instancia desconectada, o sin
   guardado de mensajes).
2. Evolution los tiene, pero indexados bajo un JID distinto del que consulta
   la app: el historial filtra por un solo ``remoteJid``, el que devuelve
   ``resolve_whatsapp_destination``, y WhatsApp puede usar ``@lid`` para los
   entrantes y el teléfono para los salientes del mismo chat.
3. Se perdieron entre Evolution y la base (n8n, cola, o un rechazo del webhook
   de identidad).

El script prueba cada alias del lead por separado y muestra el resultado crudo,
incluidos los errores HTTP: un fallo silencioso es indistinguible de un chat
sin historial, que es justo lo que hay que evitar acá.

No escribe nada: es solo lectura sobre PostgreSQL y sobre Evolution.

Uso desde el contenedor del backend::

    python -m scripts.diagnose_whatsapp_chat --chat-id <uuid-del-lead>
    python -m scripts.diagnose_whatsapp_chat --telefono 51997511558
    python -m scripts.diagnose_whatsapp_chat --telefono 51997511558 --buscar-chats
    python -m scripts.diagnose_whatsapp_chat --jid 267692862898397@lid
"""

import argparse
import asyncio
import json
import re
from typing import Any

import httpx
from sqlalchemy import func, select

from db.models import Lead, WhatsAppIdentity, WspMessage
from db.session import close_engine, get_sessionmaker
from services.settings_service import get_effective_many

PAGE_SIZE = 50
# Tope del barrido de chats. Con 100 por página cubre 5000 conversaciones, de
# sobra para encontrar un LID reciente sin quedarse colgado en una instancia
# con años de historial.
MAX_CHAT_PAGES = 50
CHAT_PAGE_SIZE = 100


def _records(payload: Any, key: str) -> tuple[list[dict], int | None]:
    """Saca la lista de registros y el total de páginas, sea cual sea la forma.

    Deliberadamente no reutiliza el extractor de ``services.whatsapp_history``:
    este script se usa para diagnosticar justamente ese módulo, y compartir el
    parseo escondería una diferencia de forma entre versiones de Evolution en
    lugar de mostrarla.
    """
    if isinstance(payload, list):
        return [r for r in payload if isinstance(r, dict)], None
    if not isinstance(payload, dict):
        return [], None

    node = payload.get(key, payload)
    if isinstance(node, list):
        return [r for r in node if isinstance(r, dict)], None
    if isinstance(node, dict):
        records = node.get("records")
        if isinstance(records, list):
            pages = node.get("pages")
            return (
                [r for r in records if isinstance(r, dict)],
                pages if isinstance(pages, int) else None,
            )
    return [], None


def _timestamp(record: dict) -> int | None:
    raw = record.get("messageTimestamp")
    if isinstance(raw, dict):
        raw = raw.get("low", raw.get("seconds"))
    try:
        value = int(raw)
    except (TypeError, ValueError):
        return None
    return value // 1000 if value > 1_000_000_000_000 else value


def _preview(record: dict) -> str:
    """Una línea por mensaje: dirección, fecha, tipo y un pedazo del texto."""
    from datetime import datetime, timezone

    key = record.get("key") if isinstance(record.get("key"), dict) else {}
    seconds = _timestamp(record)
    when = (
        datetime.fromtimestamp(seconds, tz=timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
        if seconds
        else "sin fecha"
    )
    message = record.get("message") if isinstance(record.get("message"), dict) else {}
    kind = next(iter(message), "?")
    text = message.get("conversation")
    if not isinstance(text, str):
        extended = message.get("extendedTextMessage")
        text = extended.get("text") if isinstance(extended, dict) else None
    body = (text or "").replace("\n", " ")[:50]
    origen = "vendedor" if key.get("fromMe") else "cliente "
    return f"    {when}Z  {origen}  {kind:<22} {body}"


async def _lead_snapshot(chat_id: str | None, digits: str | None) -> dict | None:
    """Lo que la base sabe del lead: alias registrados y mensajes por remitente."""
    async with get_sessionmaker()() as session:
        lead_id = chat_id
        if lead_id is None and digits:
            # El alias es la identidad real; `telefono` es solo el espejo legible.
            lead_id = await session.scalar(
                select(WhatsAppIdentity.lead_id)
                .where(WhatsAppIdentity.jid == f"{digits}@s.whatsapp.net")
                .limit(1)
            )
            if lead_id is None:
                lead_id = await session.scalar(
                    select(Lead.id).where(Lead.telefono == f"+{digits}").limit(1)
                )
        if lead_id is None:
            return None

        lead = await session.get(Lead, lead_id)
        if lead is None:
            return None

        aliases = (
            await session.execute(
                select(
                    WhatsAppIdentity.jid,
                    WhatsAppIdentity.kind,
                    WhatsAppIdentity.instance,
                    WhatsAppIdentity.created_at,
                )
                .where(WhatsAppIdentity.lead_id == lead_id)
                .order_by(WhatsAppIdentity.created_at)
            )
        ).mappings().all()

        counts = (
            await session.execute(
                select(
                    WspMessage.sender,
                    func.count(),
                    func.min(WspMessage.sent_at),
                    func.max(WspMessage.sent_at),
                )
                .where(WspMessage.chat_id == lead_id)
                .group_by(WspMessage.sender)
            )
        ).all()

    return {
        "id": lead.id,
        "telefono": lead.telefono,
        "nombre": lead.nombre,
        "created_at": lead.created_at,
        "aliases": [dict(row) for row in aliases],
        "counts": counts,
    }


async def _probe_jid(client: httpx.AsyncClient, base: str, instance: str, jid: str) -> None:
    """Pide la primera página de historial de ese JID y describe lo que vuelve."""
    url = f"{base}/chat/findMessages/{instance}"
    payload = {"where": {"key": {"remoteJid": jid}}, "page": 1, "offset": PAGE_SIZE}
    try:
        response = await client.post(url, json=payload)
    except httpx.HTTPError as exc:
        print(f"  {jid}: ERROR de red -> {exc!r}")
        return

    if response.is_error:
        # El cuerpo importa tanto como el código: un 400 por payload y un 404
        # por instancia inexistente se diagnostican distinto.
        print(f"  {jid}: HTTP {response.status_code} -> {response.text[:300]}")
        return

    try:
        data = response.json()
    except ValueError:
        print(f"  {jid}: respuesta no-JSON ({len(response.content)} bytes) -> {response.text[:200]!r}")
        return

    records, pages = _records(data, "messages")
    total = None
    if isinstance(data, dict) and isinstance(data.get("messages"), dict):
        total = data["messages"].get("total")

    print(f"  {jid}: {len(records)} registros en la página 1 (total={total}, pages={pages})")
    if not records:
        # Distingue "no hay filas" de "la forma de la respuesta cambió".
        print(f"    respuesta cruda: {json.dumps(data)[:300]}")
        return
    for record in records[:8]:
        print(_preview(record))
    if len(records) > 8:
        print(f"    ... y {len(records) - 8} más en esta página")


async def _buscar_chats(
    client: httpx.AsyncClient, base: str, instance: str, digits: str
) -> None:
    """Barre los chats de Evolution buscando cualquiera que mencione el número.

    Sirve para descubrir el ``@lid`` de un contacto cuando ese alias no está
    registrado en la base: si WhatsApp guarda la conversación bajo un LID, el
    teléfono suele seguir apareciendo en el registro del chat (``remoteJidAlt``,
    nombre o número del contacto).
    """
    url = f"{base}/chat/findChats/{instance}"
    print(f"\nBarrido de chats buscando '{digits}':")
    escaneados = 0
    lids = 0
    encontrados: list[str] = []

    for page in range(1, MAX_CHAT_PAGES + 1):
        try:
            response = await client.post(
                url, json={"page": page, "offset": CHAT_PAGE_SIZE}
            )
        except httpx.HTTPError as exc:
            print(f"  ERROR de red en la página {page} -> {exc!r}")
            return
        if response.is_error:
            print(f"  HTTP {response.status_code} -> {response.text[:300]}")
            return
        try:
            data = response.json()
        except ValueError:
            print(f"  respuesta no-JSON en la página {page}: {response.text[:200]!r}")
            return

        records, pages = _records(data, "chats")
        if not records:
            break
        for record in records:
            escaneados += 1
            remote_jid = str(record.get("remoteJid") or record.get("id") or "")
            if remote_jid.endswith("@lid"):
                lids += 1
            if digits in json.dumps(record, default=str):
                encontrados.append(f"{remote_jid}  {json.dumps(record, default=str)[:200]}")
        if pages is not None and page >= pages:
            break
        if len(records) < CHAT_PAGE_SIZE:
            break

    print(f"  chats escaneados: {escaneados} (de los cuales {lids} son @lid)")
    if encontrados:
        print("  coincidencias:")
        for linea in encontrados:
            print(f"    {linea}")
    else:
        print("  ninguna coincidencia: Evolution no tiene ningún chat que mencione ese número")


async def run(args: argparse.Namespace) -> int:
    digits = re.sub(r"\D", "", args.telefono) if args.telefono else None
    if not (args.chat_id or digits or args.jid):
        raise ValueError("Indicá --chat-id, --telefono o --jid")

    jids: list[str] = list(args.jid or [])

    if args.chat_id or digits:
        snapshot = await _lead_snapshot(args.chat_id, digits)
        if snapshot is None:
            print("Lead no encontrado en la base.")
        else:
            print(
                f"Lead {snapshot['id']}  telefono={snapshot['telefono']} "
                f"nombre={snapshot['nombre']!r} creado={snapshot['created_at']}"
            )
            print("Alias registrados:")
            if not snapshot["aliases"]:
                print("  (ninguno: la app no puede ni enviar ni pedir historial de este lead)")
            for alias in snapshot["aliases"]:
                print(
                    f"  {alias['jid']:<34} kind={alias['kind']:<6} "
                    f"instance={alias['instance']:<12} creado={alias['created_at']}"
                )
                if alias["jid"] not in jids:
                    jids.append(alias["jid"])
            print("Mensajes en la base:")
            if not snapshot["counts"]:
                print("  (ninguno)")
            for sender, cantidad, primero, ultimo in snapshot["counts"]:
                print(f"  {sender:<9} {cantidad:>5}   desde {primero}   hasta {ultimo}")

    # El JID del teléfono se prueba aunque no esté registrado como alias: es el
    # que usaría la app si el lead lo tuviera, y su ausencia es un hallazgo.
    if digits and f"{digits}@s.whatsapp.net" not in jids:
        jids.append(f"{digits}@s.whatsapp.net")

    config = await get_effective_many((
        "evolution_api_url",
        "evolution_api_key",
        "evolution_instance",
    ))
    if not all(config.values()):
        faltantes = [clave for clave, valor in config.items() if not valor]
        raise RuntimeError(f"Evolution API no está configurada; falta: {', '.join(faltantes)}")

    base = config["evolution_api_url"].rstrip("/")
    instance = config["evolution_instance"]
    print(f"\nEvolution: {base} instancia={instance}")

    async with httpx.AsyncClient(
        headers={"apikey": config["evolution_api_key"]}, timeout=60.0
    ) as client:
        print("Historial por JID:")
        for jid in jids:
            await _probe_jid(client, base, instance, jid)
        if args.buscar_chats and digits:
            await _buscar_chats(client, base, instance, digits)

    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--chat-id", help="UUID del lead (el de la URL del chat)")
    parser.add_argument("--telefono", help="Número con código de país, solo dígitos")
    parser.add_argument(
        "--jid",
        action="append",
        help="JID extra a probar (repetible). Útil para verificar un @lid encontrado",
    )
    parser.add_argument(
        "--buscar-chats",
        action="store_true",
        help="Barre chat/findChats buscando el número, para descubrir un @lid no registrado",
    )
    return parser


def main() -> int:
    args = build_parser().parse_args()
    try:
        return asyncio.run(run(args))
    finally:
        asyncio.run(close_engine())


if __name__ == "__main__":
    raise SystemExit(main())
