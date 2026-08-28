"""Descifrado de la edición nativa (`secretEncryptedMessage`).

La mayoría de los casos se validan con un round-trip sintético: cifrar acá,
con el mismo algoritmo, y comprobar que `decrypt_edited_text` lo recupera.
`TestRealCapturedMessage` usa un evento real capturado en producción (editar
"hola" -> "hola8") — reveló dos bugs que el round-trip sintético no detectaba
porque generaba protobufs más simples que los reales: el texto real queda
anidado más de un nivel (`MAX_EXTRACT_DEPTH`), y el wire format trae el
remoteJid/wa_message_id de la MessageKey ANTES que el texto, así que sin
filtrar esos patrones `extract_text` devolvía el JID en vez de lo escrito.
"""

import base64
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

    def test_skips_jid_and_message_id_in_favor_of_deeper_real_text(self):
        # Reproduce el orden real: MessageKey (remoteJid, luego el id del
        # mensaje) aparece ANTES que el texto editado, y ambos son strings
        # UTF-8 tan "razonables" como el texto real.
        key = (
            _length_delimited_field(1, "164291709825075@lid".encode())
            + _length_delimited_field(3, "3EB0FFFBD8FCB1091B3E45".encode())
        )
        edited_text = _length_delimited_field(1, "hola8".encode())
        proto = (
            _length_delimited_field(1, key)
            + _length_delimited_field(14, edited_text)
        )
        assert extract_text(proto) == "hola8"

    def test_only_identifiers_present_yields_no_text(self):
        key = (
            _length_delimited_field(1, "164291709825075@lid".encode())
            + _length_delimited_field(3, "3EB0FFFBD8FCB1091B3E45".encode())
        )
        proto = _length_delimited_field(1, key)
        assert extract_text(proto) is None


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


class TestRealCapturedMessage:
    """Evento real: editar el mensaje "hola" (wa_message_id
    3EB0FFFBD8FCB1091B3E45) a "hola8", capturado en producción vía pinData de
    n8n. `message_secret` es el guardado en `wsp_messages` para ese mensaje;
    `enc_payload`/`enc_iv` son los del evento `secretEncryptedMessage`
    correspondiente."""

    SECRET = bytes.fromhex(
        "22f92d465628eeaad2903683bca260c5be12dcc2516e72ada9890c1ad7fb0378"
    )
    MESSAGE_ID = "3EB0FFFBD8FCB1091B3E45"
    SENDER_CANDIDATES = ["267692862898397@lid"]
    ENC_PAYLOAD = base64.b64decode(
        "zLfn3/EejLBNhZuC3N6/Iq3wq1Vf61WGwhwH5vy8xCEzJpHq99jGwLz3cNMpWRwl"
        "RVQSnX7vL8xh+pPG8cHq4Hz3hVc/6SKIpt77o2dQAMU4RNBNNdVY"
    )
    ENC_IV = base64.b64decode("eNaUNf8WilpAF3rV")

    def test_recovers_the_edited_text(self):
        result = decrypt_edited_text(
            secret=self.SECRET,
            message_id=self.MESSAGE_ID,
            sender_candidates=self.SENDER_CANDIDATES,
            enc_payload=self.ENC_PAYLOAD,
            enc_iv=self.ENC_IV,
        )

        assert result == "hola8"
