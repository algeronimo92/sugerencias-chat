from pathlib import Path

LEGACY_DIR = Path(__file__).resolve().parent.parent / "migrations"
LAST_LEGACY_NUMBER = 30


def test_no_new_manual_sql_migrations_are_added():
    sql_files = sorted(LEGACY_DIR.glob("*.sql"))
    numbers = [int(path.name.split("_", 1)[0]) for path in sql_files]

    assert max(numbers) == LAST_LEGACY_NUMBER, (
        "Los cambios de esquema van como revisión de Alembic en backend/alembic/versions/"
    )
    assert len(numbers) == LAST_LEGACY_NUMBER
