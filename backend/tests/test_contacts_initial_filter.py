"""El filtro A-Z de la agenda: qué inicial acepta la ruta y cómo se pliega
la primera letra del nombre (tildes a la vocal, la Ñ aparte)."""

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.bootstrap import domain_error_handler
from app.core.errors import DomainError
from app.modules.auth.public import get_current_user
from app.modules.contacts import api as contacts_api
from app.modules.contacts.queries import _FOLD_FROM, _FOLD_TO, INITIAL_LETTERS
from tests.permission_fakes import use_role_matrix


def _initial_of(name: str) -> str:
    """Lo mismo que hace la consulta con translate(), en Python."""
    first = name.strip()[:1].translate(str.maketrans(_FOLD_FROM, _FOLD_TO))
    return first if first in INITIAL_LETTERS else "#"


def test_fold_tables_line_up_one_to_one():
    # translate() de PostgreSQL borra los caracteres sin pareja: un desfase
    # haría desaparecer letras en vez de plegarlas.
    assert len(_FOLD_FROM) == len(_FOLD_TO)
    assert len(set(_FOLD_FROM)) == len(_FOLD_FROM)


@pytest.mark.parametrize(("name", "initial"), [
    ("Ana", "a"), ("ángela", "a"), ("Ángela", "a"), ("Élmer", "e"), ("Úrsula", "u"), ("Çelik", "c"),
    ("Ñique", "ñ"), ("ñato", "ñ"), ("Nora", "n"), ("zoe", "z"), ("Zoe", "z"),
    ("1er cliente", "#"), ("@usuario", "#"), ("", "#"),
])
def test_first_letter_is_folded_like_a_phone_book(name, initial):
    assert _initial_of(name) == initial


@pytest.fixture
def client(monkeypatch):
    listed = AsyncMock(return_value={"items": [], "total": 0})
    monkeypatch.setattr(contacts_api, "list_contacts", listed)
    monkeypatch.setattr(contacts_api, "seller_scope", AsyncMock(return_value=None))
    use_role_matrix(monkeypatch)
    app = FastAPI()
    app.add_exception_handler(DomainError, domain_error_handler)
    app.include_router(contacts_api.router)
    app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id=1, role="admin")
    return TestClient(app), listed


@pytest.mark.parametrize("initial", ["A", "z", "Ñ", "ñ", "#"])
def test_the_route_passes_a_single_initial_to_the_query(client, initial):
    http, listed = client
    response = http.get("/api/contacts", params={"initial": initial})
    assert response.status_code == 200
    assert listed.await_args.kwargs["initial"] == initial


@pytest.mark.parametrize("initial", ["AB", "1", "%", "Á", " "])
def test_the_route_rejects_anything_but_one_letter_or_hash(client, initial):
    http, listed = client
    assert http.get("/api/contacts", params={"initial": initial}).status_code == 422
    listed.assert_not_awaited()
