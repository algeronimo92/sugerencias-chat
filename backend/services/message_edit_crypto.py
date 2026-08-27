"""Descifra la edición nativa de un mensaje (`secretEncryptedMessage`).

Desde ~mayo 2026 WhatsApp dejó de mandar la edición hecha desde la app nativa
(no desde este CRM) como `protocolMessage` en texto plano y ahora la manda
cifrada. Evolution API no la descifra, así que este módulo reimplementa el
algoritmo del lado del backend — confirmado funcional por la comunidad de
Baileys en WhiskeySockets/Baileys#2541 — para reusar el pipeline de edición
ya existente (`db_service.update_message_content`).

Derivación de clave (HKDF-SHA256 de un bloque, cada paso es un HMAC-SHA256):

    prk    = HMAC-SHA256(key=32 ceros, data=secret)
    info   = id + sender + sender + b"Message Edit" + b"\\x01"
    decKey = HMAC-SHA256(key=prk, data=info)

`sender` aparece dos veces seguidas en `info` y el `\\x01` final es el
contador estándar de HKDF-expand de un solo bloque — así está en la
referencia, no es un error de transcripción.

Descifrado: AES-256-GCM con `decKey`, `nonce=encIv` (12 bytes), AAD vacío;
`encPayload` ya incluye el tag de 16 bytes al final (formato estándar de
Baileys).

El resultado es un `proto.Message` serializado. Como solo se pueden editar
mensajes de texto, el contenido es un `conversation` (string) o un
`extendedTextMessage.text` (string anidado un nivel). No replicamos el
.proto completo de WhatsApp (es enorme y no lo tenemos): en vez de eso hay un
extractor genérico y tolerante del wire format de protobuf.

Módulo puro, sin I/O: pensado para ser fácil de testear.
"""

from __future__ import annotations

import hashlib
import hmac

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

_HKDF_ZERO_SALT = b"\x00" * 32
_INFO_SUFFIX = b"Message Edit\x01"


def derive_edit_key(secret: bytes, message_id: str, sender: str) -> bytes:
    """HKDF-SHA256 (un bloque) de la clave con la que WhatsApp cifra la
    edición de `message_id`, para el JID `sender` que la originó."""
    prk = hmac.new(_HKDF_ZERO_SALT, secret, hashlib.sha256).digest()
    sender_bytes = sender.encode("ascii")
    info = message_id.encode("ascii") + sender_bytes + sender_bytes + _INFO_SUFFIX
    return hmac.new(prk, info, hashlib.sha256).digest()


def _read_varint(data: bytes, pos: int) -> tuple[int, int]:
    result = 0
    shift = 0
    while True:
        if pos >= len(data):
            raise ValueError("varint truncado")
        byte = data[pos]
        pos += 1
        result |= (byte & 0x7F) << shift
        if not (byte & 0x80):
            return result, pos
        shift += 7
        if shift > 63:
            raise ValueError("varint demasiado largo")


def _iter_length_delimited_fields(data: bytes):
    """Recorre el wire format de protobuf y produce (field_no, value) solo
    para los campos wire-type 2 (length-delimited: string/bytes/mensaje
    anidado) — los únicos que nos pueden dar texto. Nunca revienta: ante
    cualquier dato truncado o un wire type que no sabemos saltar (grupos
    deprecados, tipo 3/4) simplemente deja de producir campos."""
    pos = 0
    size = len(data)
    while pos < size:
        try:
            tag, pos = _read_varint(data, pos)
        except ValueError:
            return
        wire_type = tag & 0x7
        field_no = tag >> 3
        if wire_type == 0:  # varint
            try:
                _, pos = _read_varint(data, pos)
            except ValueError:
                return
        elif wire_type == 1:  # 64-bit
            pos += 8
        elif wire_type == 2:  # length-delimited
            try:
                length, pos = _read_varint(data, pos)
            except ValueError:
                return
            if length < 0 or pos + length > size:
                return
            yield field_no, data[pos:pos + length]
            pos += length
        elif wire_type == 5:  # 32-bit
            pos += 4
        else:
            return
        if pos > size:
            return


def _as_reasonable_text(raw: bytes) -> str | None:
    if not raw:
        return None
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        return None
    stripped = text.strip()
    if not stripped:
        return None
    # Sin excepciones: un solo byte de control (p. ej. el tag/length de un
    # protobuf anidado que se cuela porque decodifica como UTF-8 válido)
    # descarta el candidato. Sin esto, un mensaje anidado de un tamaño que
    # cae en control-chars igual "se lee bien" por ratio y gana antes de
    # intentar la recursión que sí lo separa del header.
    if not all(ch.isprintable() or ch in "\n\r\t" for ch in text):
        return None
    return stripped


def extract_text(data: bytes, *, _depth: int = 0) -> str | None:
    """Primer string UTF-8 "razonable" en el wire format de `data`, buscando
    tanto a nivel superior (`conversation`) como un nivel adentro de un
    mensaje anidado (`extendedTextMessage.text`). Ver docstring del módulo:
    evita depender de números de campo exactos del .proto de WhatsApp."""
    for _field_no, value in _iter_length_delimited_fields(data):
        candidate = _as_reasonable_text(value)
        if candidate is not None:
            return candidate
        if _depth == 0:
            nested = extract_text(value, _depth=1)
            if nested is not None:
                return nested
    return None


def decrypt_edited_text(
    *,
    secret: bytes,
    message_id: str,
    sender_candidates: list[str],
    enc_payload: bytes,
    enc_iv: bytes,
) -> str | None:
    """Descifra y extrae el texto nuevo de una edición nativa, o None si no
    se pudo (ningún candidato de sender destraba el tag de GCM, o el
    resultado no contiene un texto reconocible). Nunca lanza.

    El `sender` puede venir como `@lid` o `@s.whatsapp.net` (ver
    docs/n8n-identidad-whatsapp-lid.md) y no hay forma de confirmar de
    antemano cuál usó el cliente de WhatsApp para derivar la clave del lado
    del emisor: se prueba cada candidato hasta que el tag de GCM valide —
    `cryptography` lanza `InvalidTag` cuando el candidato es incorrecto, esa
    es la señal para probar el siguiente.
    """
    for sender in sender_candidates:
        try:
            key = derive_edit_key(secret, message_id, sender)
            plaintext = AESGCM(key).decrypt(enc_iv, enc_payload, None)
        except (InvalidTag, ValueError, UnicodeEncodeError):
            continue
        text = extract_text(plaintext)
        if text is not None:
            return text
    return None
