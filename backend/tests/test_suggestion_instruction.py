"""Saneo de la indicación del asesor en SuggestionRequest.

La instrucción viaja como query param hasta el workflow de n8n y de ahí al
prompt: tiene que llegar en una sola línea, sin caracteres de control y con
un largo acotado, sin importar qué se pegue en el input.
"""

from models.schemas import SUGGESTION_INSTRUCTION_MAX_LENGTH, SuggestionRequest


def _request(instruction):
    return SuggestionRequest(chat_id="123@s.whatsapp.net", instruction=instruction)


def test_sin_instruccion_queda_none():
    assert _request(None).instruction is None


def test_texto_normal_pasa_intacto():
    assert _request("no dar precio").instruction == "no dar precio"


def test_colapsa_espacios_y_saltos_de_linea():
    assert (
        _request("  el cliente\n\nestá  súper\tinteresado ").instruction
        == "el cliente está súper interesado"
    )


def test_descarta_caracteres_de_control():
    assert _request("dar\x00 precio\x07").instruction == "dar precio"


def test_recorta_al_maximo_permitido():
    larga = "x" * (SUGGESTION_INSTRUCTION_MAX_LENGTH * 2)
    resultado = _request(larga).instruction
    assert resultado is not None
    assert len(resultado) == SUGGESTION_INSTRUCTION_MAX_LENGTH


def test_vacia_o_solo_espacios_queda_none():
    assert _request("").instruction is None
    assert _request("   \n\t ").instruction is None
