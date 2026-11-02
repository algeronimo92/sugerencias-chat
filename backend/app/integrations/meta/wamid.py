"""Identidad de un mensaje dentro de su ``wamid``.

Un mismo mensaje puede llegar con dos ``wamid`` distintos: el que devuelve la
API al enviarlo lleva el número del contacto y el que trae un eco de
coexistencia (una edición o un borrado hecho desde el celular) lleva su BSUID.
Lo que no cambia es la clave del mensaje que va al final, junto con el byte que
dice si salió o entró. Comparar esa clave es lo que permite encontrar el
original de un ``edit`` o un ``revoke``.

El ``wamid`` es base64 de esta estructura (sin documentar por Meta, se lee
defensivamente y ante cualquier duda devuelve None)::

    0x1c 0x18 <largo> <destinatario> 0x15 <x> 0x00 <sentido> 0x18 <largo> <clave> 0x00
"""

from __future__ import annotations

import base64
import binascii

_PREFIX = "wamid."


def message_key(wa_message_id: str | None) -> str | None:
    """``"<sentido>:<clave>"`` del mensaje, o None si el id no tiene esa forma."""

    if not wa_message_id or not wa_message_id.startswith(_PREFIX):
        return None
    encoded = wa_message_id[len(_PREFIX):]
    try:
        raw = base64.b64decode(encoded + "=" * (-len(encoded) % 4), altchars=b"-_")
    except (binascii.Error, ValueError):
        return None
    if len(raw) < 4 or raw[0] != 0x1C or raw[1] != 0x18:
        return None
    index = 3 + raw[2]  # salta el destinatario
    if len(raw) < index + 6 or raw[index] != 0x15:
        return None
    direction = raw[index + 3]
    index += 4
    if raw[index] != 0x18:
        return None
    length = raw[index + 1]
    key = raw[index + 2:index + 2 + length]
    if len(key) != length or not key.isalnum():
        return None
    return f"{direction:02x}:{key.decode()}"
