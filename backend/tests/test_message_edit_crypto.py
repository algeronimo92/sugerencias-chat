"""Descifrado de la edición nativa (`secretEncryptedMessage`).

No hay ningún `messageSecret` real capturado todavía (nunca se guardó antes
de esta migración), así que lo único que se puede validar de verdad es un
round-trip sintético: cifrar acá, con el mismo algoritmo, y comprobar que
`decrypt_edited_text` lo recupera.
"""

import os

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from services.message_edit_crypto import decrypt_edited_text, derive_edit_key, extract_text

MESSAGE_ID = "3EB0ABCDEF1234567890"
SENDER = "51999888777@s.whatsapp.net"
SECRET = os.urandom(32)


def _varint(n: int) -> bytes:
    out = bytearray()
    while True:
        byte = n & 0x7F
        n >>= 7
        if n:
            out.append(byte | 0x80)
        else:
            out.append(byte)
            return bytes(out)


def _length_delimited_field(field_no: int, payload: bytes) -> bytes:
    tag = (field_no << 3) | 2
    return _varint(tag) + _varint(len(payload)) + payload


def _encrypt(plaintext: bytes, *, sender: str = SENDER, message_id: str = MESSAGE_ID) -> tuple[bytes, bytes]:
    key = derive_edit_key(SECRET, message_id, sender)
    nonce = os.urandom(12)
    ciphertext = AESGCM(key).encrypt(nonce, plaintext, None)
    return ciphertext, nonce


class TestExtractText:
    def test_top_level_conversation_string(self):
        proto = _length_delimited_field(1, "Perdón, el precio correcto es 450".encode())
        assert extract_text(proto) == "Perdón, el precio correcto es 450"

    def test_nested_extended_text_message(self):
        inner = _length_delimited_field(1, "Editado desde el teléfono".encode())
        proto = _length_delimited_field(2, inner)
        assert extract_text(proto) == "Editado desde el teléfono"

    def test_binary_garbage_yields_no_text(self):
        assert extract_text(bytes([0xFF, 0x00, 0x01, 0x02, 0x80, 0x81])) is None

    def test_empty_message_yields_no_text(self):
        assert extract_text(b"") is None


class TestDecryptEditedText:
    def test_round_trip_top_level_conversation(self):
        plaintext = _length_delimited_field(1, "texto corregido".encode())
        ciphertext, nonce = _encrypt(plaintext)

        result = decrypt_edited_text(
            secret=SECRET,
            message_id=MESSAGE_ID,
            sender_candidates=[SENDER],
            enc_payload=ciphertext,
            enc_iv=nonce,
        )

        assert result == "texto corregido"

    def test_round_trip_nested_extended_text_message(self):
        inner = _length_delimited_field(1, "segunda corrección".encode())
        plaintext = _length_delimited_field(2, inner)
        ciphertext, nonce = _encrypt(plaintext)

        result = decrypt_edited_text(
            secret=SECRET,
            message_id=MESSAGE_ID,
            sender_candidates=[SENDER],
            enc_payload=ciphertext,
            enc_iv=nonce,
        )

        assert result == "segunda corrección"

    def test_tries_next_sender_candidate_until_one_validates(self):
        # Simula no saber si WhatsApp derivó la clave con el @lid o el
        # @s.whatsapp.net del remitente: el candidato correcto va segundo.
        plaintext = _length_delimited_field(1, "hola".encode())
        ciphertext, nonce = _encrypt(plaintext, sender=SENDER)

        result = decrypt_edited_text(
            secret=SECRET,
            message_id=MESSAGE_ID,
            sender_candidates=["999@lid", SENDER],
            enc_payload=ciphertext,
            enc_iv=nonce,
        )

        assert result == "hola"

    def test_no_candidate_matches_returns_none_without_raising(self):
        plaintext = _length_delimited_field(1, "hola".encode())
        ciphertext, nonce = _encrypt(plaintext, sender=SENDER)

        result = decrypt_edited_text(
            secret=SECRET,
            message_id=MESSAGE_ID,
            sender_candidates=["999@lid", "888@lid"],
            enc_payload=ciphertext,
            enc_iv=nonce,
        )

        assert result is None

    def test_wrong_secret_returns_none_without_raising(self):
        plaintext = _length_delimited_field(1, "hola".encode())
        ciphertext, nonce = _encrypt(plaintext)

        result = decrypt_edited_text(
            secret=os.urandom(32),
            message_id=MESSAGE_ID,
            sender_candidates=[SENDER],
            enc_payload=ciphertext,
            enc_iv=nonce,
        )

        assert result is None

    def test_malformed_iv_returns_none_without_raising(self):
        plaintext = _length_delimited_field(1, "hola".encode())
        ciphertext, _nonce = _encrypt(plaintext)

        result = decrypt_edited_text(
            secret=SECRET,
            message_id=MESSAGE_ID,
            sender_candidates=[SENDER],
            enc_payload=ciphertext,
            enc_iv=b"demasiado-corto",
        )

        assert result is None
