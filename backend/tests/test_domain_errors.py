"""Traducción única de errores de dominio a HTTP."""

import httpx
import pytest

from app.bootstrap import app
from app.core.errors import Conflict, DomainError, Forbidden, Gone, Invalid, NotFound, Unauthorized, Unavailable


@pytest.mark.parametrize("error,status", [
    (Invalid, 422), (Unauthorized, 401), (Forbidden, 403), (NotFound, 404),
    (Conflict, 409), (Gone, 410), (Unavailable, 503),
])
def test_each_kind_has_its_status(error, status):
    assert error().status_code == status


def test_detail_keeps_strings_and_structured_payloads():
    assert Conflict("Ya existe").to_response() == {"detail": "Ya existe", "code": "conflict"}
    stale = Conflict({"code": "stale_ai_context", "current_revision": "v1"}, code="stale_ai_context")
    assert stale.to_response() == {
        "detail": {"code": "stale_ai_context", "current_revision": "v1"},
        "code": "stale_ai_context",
    }


def test_a_subclass_can_name_its_own_code():
    class LostReasonRequired(Invalid):
        """Falta la razón de pérdida."""

        code = "lost_reason_required"

    error = LostReasonRequired()
    assert error.to_response() == {"detail": "Falta la razón de pérdida.", "code": "lost_reason_required"}


async def test_the_app_translates_an_uncaught_domain_error():
    @app.get("/__test__/domain-error")
    async def raise_conflict():
        raise Conflict("La etapa está en uso")

    try:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
            response = await client.get("/__test__/domain-error")
    finally:
        app.router.routes[:] = [r for r in app.router.routes if getattr(r, "path", "") != "/__test__/domain-error"]

    assert response.status_code == 409
    assert response.json() == {"detail": "La etapa está en uso", "code": "conflict"}


def test_domain_errors_are_plain_exceptions():
    assert issubclass(DomainError, Exception)
