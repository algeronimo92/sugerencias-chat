"""La condición de búsqueda de chats debe comportarse como la de WhatsApp:
insensible a acentos, sobre todo el historial de mensajes y tolerante al
formato de los teléfonos. Se verifica compilando el SQL generado (no hay
PostgreSQL en la suite)."""

import pytest
from sqlalchemy.dialects import postgresql

from services import db_service
from services.db_service import (
    _chat_search_condition,
    _escape_like,
    _matched_message_subquery,
    _search_rank_expression,
)


def _compile(search: str) -> str:
    condition = _chat_search_condition(search)
    sql = str(condition.compile(
        dialect=postgresql.dialect(),
        compile_kwargs={"literal_binds": True},
    ))
    # El dialecto duplica % y \ dentro de los literales; se deshace para que
    # las aserciones lean como el SQL que ejecuta PostgreSQL.
    return sql.replace("%%", "%").replace("\\\\", "\\")


@pytest.fixture(autouse=True)
def unaccent_habilitado():
    db_service.set_unaccent_enabled(True)
    yield
    db_service.set_unaccent_enabled(True)


class TestEscapeLike:
    def test_escapa_porcentaje_y_guion_bajo(self):
        assert _escape_like("100%") == "100\\%"
        assert _escape_like("user_1") == "user\\_1"

    def test_escapa_backslash_antes_que_wildcards(self):
        assert _escape_like("a\\%b") == "a\\\\\\%b"

    def test_texto_normal_queda_igual(self):
        assert _escape_like("José Pérez") == "José Pérez"


class TestCondicionDeBusqueda:
    def test_usa_unaccent_en_campos_de_texto(self):
        sql = _compile("jose")
        assert "f_unaccent(leads.nombre)" in sql
        assert "f_unaccent('%jose%')" in sql

    def test_busca_en_historial_completo_no_solo_ultimo_mensaje(self):
        sql = _compile("botox")
        assert "EXISTS" in sql
        assert "wsp_messages" in sql
        assert "f_unaccent(wsp_messages.content)" in sql

    def test_telefono_matchea_por_digitos_sin_formato(self):
        sql = _compile("+54 9 11 1234-5678")
        assert "regexp_replace(leads.telefono" in sql
        assert "'%5491112345678%'" in sql

    def test_pocos_digitos_no_activa_matching_por_telefono(self):
        # "av 9" tiene un solo dígito: compararlo contra teléfonos
        # normalizados matchearía casi toda la base.
        sql = _compile("av 9")
        assert "regexp_replace" not in sql

    def test_wildcards_del_usuario_se_escapan(self):
        sql = _compile("100%")
        assert "100\\%" in sql
        assert "ESCAPE '\\'" in sql

    def test_sin_unaccent_degrada_a_ilike_simple(self):
        db_service.set_unaccent_enabled(False)
        sql = _compile("jose")
        assert "f_unaccent" not in sql
        assert "leads.nombre ILIKE" in sql


def _compile_expr(expr) -> str:
    return str(expr.compile(
        dialect=postgresql.dialect(),
        compile_kwargs={"literal_binds": True},
    ))


class TestOrdenEstiloWhatsapp:
    def test_rank_no_incluye_mensajes(self):
        # El rank separa matches por datos del lead de matches por mensaje;
        # si incluyera el EXISTS de mensajes todos los resultados irían arriba.
        sql = _compile_expr(_search_rank_expression("jose"))
        assert "wsp_messages" not in sql
        assert "leads.nombre" in sql

    def test_rank_nombre_encima_de_campos_crm(self):
        # Nombre/teléfono → 2, vendedor/servicio/origen → 1, mensajes → 0.
        # Sin esta separación, buscar el nombre de un vendedor entierra al
        # lead que se llama igual bajo todos sus leads asignados.
        sql = _compile_expr(_search_rank_expression("gerson"))
        nombre_pos = sql.index("leads.nombre")
        vendedor_pos = sql.index("leads.vendedor")
        assert nombre_pos < vendedor_pos
        assert "THEN 2" in sql
        assert "THEN 1" in sql
        assert "ELSE 0" in sql

    def test_rank_coalesce_evita_nulls_en_el_orden(self):
        sql = _compile_expr(_search_rank_expression("jose"))
        assert "coalesce(" in sql

    def test_matched_message_toma_el_mas_reciente(self):
        sql = _compile_expr(_matched_message_subquery("botox"))
        assert "wsp_messages.content" in sql
        assert "ORDER BY wsp_messages.sent_at DESC" in sql
        assert "LIMIT 1" in sql
