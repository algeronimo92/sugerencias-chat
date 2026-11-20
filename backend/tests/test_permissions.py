"""Catálogo de permisos, matriz editable y su traducción a privilegios de base."""

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

from app.core.errors import Forbidden
from app.db import privileges as db
from app.db.models import Base
from app.modules.auth import roles_service
from app.modules.auth.auth_service import get_current_user, require_permission
from app.modules.auth.db_privileges import (
    DB_ROLES,
    PERMISSION_OBJECT_PRIVILEGES,
    TABLE_GROUPS,
    object_privileges_for,
)
from app.modules.auth.permissions import (
    DEFAULT_ROLE_PERMISSIONS,
    GRANTABLE_PERMISSIONS,
    PERMISSION_INFO,
    Permission,
    can,
)
from tests.permission_fakes import use_role_matrix

SELLER_DEFAULT = DEFAULT_ROLE_PERMISSIONS["vendedor"]
ANALYST_DEFAULT = DEFAULT_ROLE_PERMISSIONS["analista"]
WRITES = {"INSERT", "UPDATE", "DELETE"}


# --- Catálogo -------------------------------------------------------------

def test_every_permission_has_a_label_and_its_database_privileges():
    assert set(PERMISSION_INFO) == set(Permission)
    assert set(PERMISSION_OBJECT_PRIVILEGES) == set(Permission)


def test_every_business_table_belongs_to_a_privilege_group():
    tenant_tables = {table.name for table in Base.metadata.tables.values() if table.schema is None}
    grouped = [table for tables in TABLE_GROUPS.values() for table in tables]
    assert len(grouped) == len(set(grouped)), "una tabla está en dos grupos"
    assert set(grouped) == tenant_tables


def test_the_migration_seeds_the_same_catalog_as_the_code():
    import importlib.util
    from pathlib import Path
    path = Path(__file__).resolve().parents[1] / "alembic" / "versions" / "7b1525154ac6_roles_y_permisos.py"
    spec = importlib.util.spec_from_file_location("roles_y_permisos", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    assert set(module.PERMISSIONS) == set(Permission)
    assert module.ADMIN_ONLY == {p.value for p, info in PERMISSION_INFO.items() if info.admin_only}
    assert set(module.SELLER_DEFAULTS) | {"leads.view_all"} == SELLER_DEFAULT
    assert set(module.ANALYST_DEFAULTS) == ANALYST_DEFAULT


# --- can / require_permission ---------------------------------------------

def test_admin_can_everything_and_other_roles_only_what_their_row_says():
    assert can(SimpleNamespace(role="admin"), Permission.USERS_MANAGE)
    seller = SimpleNamespace(role="vendedor", permissions=frozenset({Permission.LEADS_VIEW}))
    assert can(seller, Permission.LEADS_VIEW)
    assert not can(seller, Permission.LEADS_EDIT)
    # Alguno de varios alcanza.
    assert can(seller, Permission.LEADS_EDIT, Permission.LEADS_VIEW)
    # Un rol desconocido no tiene nada.
    assert not can(SimpleNamespace(role="gerente"), Permission.LEADS_VIEW)


async def test_require_permission_refuses_a_role_without_it():
    guard = require_permission(Permission.SETTINGS_MANAGE)
    assert guard.__permissions__ == {"settings.manage"}
    with pytest.raises(Forbidden):
        await guard(user=SimpleNamespace(role="vendedor"))
    assert await guard(user=SimpleNamespace(role="admin"))


def test_a_route_follows_the_edited_matrix(monkeypatch):
    from app.bootstrap import domain_error_handler
    from app.core.errors import DomainError
    app = FastAPI()
    app.add_exception_handler(DomainError, domain_error_handler)

    @app.get("/x", dependencies=[Depends(require_permission(Permission.DASHBOARD_VIEW))])
    async def route():
        return {}

    app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(
        role="vendedor", permissions=frozenset({Permission.DASHBOARD_VIEW}),
    )
    assert TestClient(app).get("/x").status_code == 200
    app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(role="vendedor", permissions=frozenset())
    assert TestClient(app).get("/x").status_code == 403


# --- Matriz editable ------------------------------------------------------

async def test_the_admin_row_and_admin_only_permissions_cannot_be_edited(monkeypatch):
    use_role_matrix(monkeypatch)
    monkeypatch.setattr(roles_service.roles_repository, "replace_role_permissions", AsyncMock())
    monkeypatch.setattr(roles_service.roles_repository, "known_permissions", AsyncMock(return_value=set(Permission)))
    with pytest.raises(roles_service.RoleNotEditableError):
        await roles_service.set_role_permissions("admin", set())
    with pytest.raises(roles_service.UnknownRoleError):
        await roles_service.set_role_permissions("gerente", set())
    with pytest.raises(roles_service.PermissionNotGrantableError):
        await roles_service.set_role_permissions("vendedor", {Permission.USERS_MANAGE})
    roles_service.roles_repository.replace_role_permissions.assert_not_awaited()


async def test_editing_a_row_saves_it_and_reapplies_the_database_grants(monkeypatch):
    use_role_matrix(monkeypatch)
    save = AsyncMock()
    sync = AsyncMock()
    monkeypatch.setattr(roles_service.roles_repository, "replace_role_permissions", save)
    monkeypatch.setattr(roles_service.roles_repository, "known_permissions", AsyncMock(return_value=set(Permission)))
    monkeypatch.setattr(roles_service, "sync_db_privileges", sync)
    await roles_service.set_role_permissions("analista", {Permission.DASHBOARD_VIEW, Permission.LEADS_VIEW})
    save.assert_awaited_once_with("analista", {Permission.DASHBOARD_VIEW, Permission.LEADS_VIEW})
    sync.assert_awaited_once()


def test_every_grantable_permission_can_be_given_to_editable_roles():
    assert GRANTABLE_PERMISSIONS == set(Permission) - {Permission.SETTINGS_MANAGE, Permission.USERS_MANAGE}


# --- Traducción a privilegios de base -------------------------------------

def test_the_admin_gets_all_the_dml_of_its_schema_and_nothing_else():
    grants = object_privileges_for("admin", frozenset())
    assert all(privileges == {"SELECT", "INSERT", "UPDATE", "DELETE"} for privileges in grants.values())
    assert set(grants) == {table for tables in TABLE_GROUPS.values() for table in tables}


def test_the_default_analyst_only_reads_business_data():
    grants = object_privileges_for("analista", ANALYST_DEFAULT)
    # Escribe solo su sesión, su contraseña, el registro de exportaciones y
    # sus reportes de problemas.
    writable = {target for target, privileges in grants.items() if privileges & WRITES}
    assert writable == {
        "auth_sessions", "trusted_devices", "auth_login_throttles", "email_notification_log",
        "users.password_hash", "data_exports", *TABLE_GROUPS["reports"],
    }
    assert grants["leads"] == {"SELECT"}
    assert "admin_totp" not in grants and "auth_action_tokens" not in grants


def test_the_default_seller_cannot_delete_leads_nor_touch_users_roles_or_settings():
    grants = object_privileges_for("vendedor", SELLER_DEFAULT)
    assert "DELETE" not in grants["leads"]
    assert grants["users"] == {"SELECT"} and grants["users.password_hash"] == {"UPDATE"}
    for table in ("roles", "permissions", "role_permissions", "app_settings"):
        assert grants[table] == {"SELECT"}
    assert "admin_totp" not in grants


def test_a_column_privilege_disappears_when_the_whole_table_has_it():
    grants = object_privileges_for("vendedor", SELLER_DEFAULT | {Permission.USERS_MANAGE})
    assert "users.password_hash" not in grants
    assert grants["users"] == {"SELECT", "INSERT", "UPDATE", "DELETE"}


def test_giving_a_permission_widens_the_database_grants_of_that_role():
    before = object_privileges_for("analista", ANALYST_DEFAULT)
    after = object_privileges_for("analista", ANALYST_DEFAULT | {Permission.LEADS_EDIT})
    assert before["leads"] == {"SELECT"}
    assert after["leads"] == {"SELECT", "INSERT", "UPDATE"}


def test_the_desired_grants_cover_the_three_database_roles():
    matrix = {role: frozenset(granted) for role, granted in DEFAULT_ROLE_PERMISSIONS.items()}
    assert set(roles_service.desired_db_grants(matrix)) == set(DB_ROLES.values()) == db.DB_ROLE_NAMES


# --- SET LOCAL ROLE -------------------------------------------------------

def test_set_role_only_happens_when_enforcement_is_active(monkeypatch):
    monkeypatch.setattr(db, "_enforcement_active", False)
    db.set_request_db_role("cv_vendedor")
    assert db.set_local_role_sql() is None
    monkeypatch.setattr(db, "_enforcement_active", True)
    db.set_request_db_role("cv_vendedor")
    assert db.set_local_role_sql() == 'SET LOCAL ROLE "cv_vendedor"'
    db.set_request_db_role(None)
    assert db.set_local_role_sql() is None


def test_unknown_database_roles_and_identifiers_are_refused():
    with pytest.raises(ValueError):
        db.set_request_db_role("postgres")
    with pytest.raises(ValueError):
        db._ident('leads"; DROP TABLE users; --')
