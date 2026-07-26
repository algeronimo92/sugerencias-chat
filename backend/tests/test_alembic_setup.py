"""Garantías del arranque de Alembic que se rompen sin hacer ruido.

El riesgo real aquí no es que una migración falle —eso se ve— sino que
`--autogenerate` proponga borrar objetos que este proyecto no gestiona. La
base de producción tiene tablas y columnas que `models.py` no declara y que
usa el flujo de n8n: `n8n_chat_histories`, `leads.metadata`,
`leads.ultimo_mensaje_at`, `leads.ultimo_emisor`, `leads.tipo_objecion` y
`wsp_messages.created_at`. Sin el filtro de `include_object`, la primera
migración autogenerada las eliminaría.
"""

from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parent.parent


@pytest.fixture(scope="module")
def env_module():
    """Carga alembic/env.py sin ejecutar su bloque de migración."""
    import importlib.util
    import sys
    from unittest.mock import MagicMock

    # env.py decide al importarse si migra; se le hace creer que está en modo
    # offline y se anula run_migrations para que no toque nada.
    fake_context = MagicMock()
    fake_context.is_offline_mode.return_value = True
    fake_context.config.config_file_name = None
    fake_context.config.get_section.return_value = {}

    spec = importlib.util.spec_from_file_location(
        "alembic_env_under_test", BACKEND / "alembic" / "env.py"
    )
    module = importlib.util.module_from_spec(spec)

    import alembic
    original = alembic.context
    alembic.context = fake_context
    sys.modules["alembic_env_under_test"] = module
    try:
        spec.loader.exec_module(module)
    finally:
        alembic.context = original
    return module


class FakeColumn:
    def __init__(self, table_name: str) -> None:
        self.table = type("T", (), {"name": table_name})()


@pytest.mark.parametrize("table", ["n8n_chat_histories", "leads_last_read_at_backup_20260720_192349"])
def test_foreign_tables_are_never_touched(env_module, table: str) -> None:
    """Ni para crearlas ni para borrarlas: no son de este proyecto."""
    assert env_module.include_object(None, table, "table", True, None) is False
    assert env_module.include_object(FakeColumn(table), "cualquiera", "column", True, None) is False


@pytest.mark.parametrize("table", ["leads", "wsp_messages"])
def test_external_tables_are_excluded_from_autogenerate(
    env_module, table: str, monkeypatch
) -> None:
    """n8n también las escribe: autogenerate no debe deducir su forma."""
    monkeypatch.delenv("ALEMBIC_BASELINE", raising=False)
    assert env_module.include_object(None, table, "table", True, None) is False


@pytest.mark.parametrize(
    "column", ["metadata", "ultimo_mensaje_at", "ultimo_emisor", "tipo_objecion"]
)
def test_columns_that_n8n_owns_are_protected(env_module, column: str, monkeypatch) -> None:
    """Estas existen en producción y no en models.py: sin filtro, se borrarían."""
    monkeypatch.delenv("ALEMBIC_BASELINE", raising=False)
    assert env_module.include_object(FakeColumn("leads"), column, "column", True, None) is False


def test_baseline_mode_does_create_external_tables(env_module, monkeypatch) -> None:
    """Una instalación desde cero sí necesita que existan leads y wsp_messages."""
    monkeypatch.setenv("ALEMBIC_BASELINE", "1")
    assert env_module.include_object(None, "leads", "table", False, None) is True
    assert env_module.include_object(None, "wsp_messages", "table", False, None) is True
    # Pero las de n8n siguen fuera incluso en modo baseline.
    assert env_module.include_object(None, "n8n_chat_histories", "table", False, None) is False


def test_own_tables_are_managed(env_module, monkeypatch) -> None:
    monkeypatch.delenv("ALEMBIC_BASELINE", raising=False)
    for table in ("users", "message_outbox", "automation_rules", "lead_tasks"):
        assert env_module.include_object(None, table, "table", True, None) is True


def test_there_is_exactly_one_head() -> None:
    """Dos cabezas hacen que `upgrade head` falle en pleno despliegue."""
    from alembic.config import Config
    from alembic.script import ScriptDirectory

    config = Config(str(BACKEND / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND / "alembic"))
    assert len(ScriptDirectory.from_config(config).get_heads()) == 1


def test_startup_no_longer_runs_ddl() -> None:
    """El lifespan no debe volver a crear esquema: es lo que impedía que dos
    instancias arrancaran a la vez."""
    source = (BACKEND / "main.py").read_text(encoding="utf-8")
    lifespan = source.split("async def lifespan", 1)[1]
    # Sin comentarios: el propio bloque explica por qué se quitó el DDL y
    # menciona esas palabras. Lo que importa es que no queden ejecutándose.
    code = "\n".join(
        line for line in lifespan.splitlines() if not line.lstrip().startswith("#")
    )
    for forbidden in ("create_all", "ALTER TABLE", "CREATE INDEX", "CREATE EXTENSION"):
        assert forbidden not in code, f"el arranque volvió a ejecutar DDL: {forbidden}"
