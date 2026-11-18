"""El cliente HTTP del ERP: qué manda y cómo traduce cada respuesta a algo
que entienda quien agenda. Nunca levanta."""

import httpx
import pytest

from app.integrations import erp_appointments as erp

FORM = {"externalId": "negocio:41", "patientName": "Rosa Quispe", "patientDni": "45678912"}


@pytest.fixture
def server(monkeypatch):
    """Un ERP de mentira: ``server.reply`` decide qué responde y
    ``server.requests`` guarda lo que recibió."""

    class Server:
        requests: list[httpx.Request] = []
        reply = staticmethod(lambda request: httpx.Response(201, json={"data": {"appointmentId": "apt-1"}}))

    state = Server()
    state.requests = []

    def handler(request: httpx.Request) -> httpx.Response:
        state.requests.append(request)
        return state.reply(request)

    monkeypatch.setattr(erp, "_client", lambda: httpx.AsyncClient(transport=httpx.MockTransport(handler)))
    return state


async def test_the_appointment_travels_as_multipart_with_the_token(server):
    reply = await erp.post_appointment("https://erp.example/", "secreto", FORM, None)

    assert reply == erp.ErpReply(ok=True, appointment_id="apt-1")
    [request] = server.requests
    assert str(request.url) == "https://erp.example/api/integrations/crm/appointments"
    assert request.headers["authorization"] == "Bearer secreto"
    assert request.headers["content-type"].startswith("multipart/form-data")
    body = request.content.decode()
    assert 'name="externalId"' in body and "negocio:41" in body
    assert 'name="receipt"' not in body


async def test_the_receipt_travels_as_a_file(server):
    await erp.post_appointment("https://erp.example", "secreto", FORM, ("voucher.png", b"\x89PNG-bytes", "image/png"))

    body = server.requests[0].content
    assert b'name="receipt"; filename="voucher.png"' in body
    assert b"Content-Type: image/png" in body
    assert b"\x89PNG-bytes" in body
    # Cada dato una sola vez: repetido, el ERP lo leería como una lista.
    assert body.count(b'name="externalId"') == 1


async def test_a_repeated_send_returns_the_same_appointment(server):
    server.reply = lambda request: httpx.Response(200, json={"data": {"appointmentId": "apt-1"}})

    assert (await erp.post_appointment("https://erp.example", "t", FORM, None)).appointment_id == "apt-1"


@pytest.mark.parametrize(("status", "payload", "expected"), [
    (401, {"error": "Token de integración inválido"}, "rechazó el token"),
    (400, {"error": "El DNI del paciente es obligatorio y debe tener 8 dígitos"}, "debe tener 8 dígitos"),
    (422, {"error": "El paquete elegido ya no existe"}, "El paquete elegido ya no existe"),
    (503, {"error": "La integración con el CRM no está configurada en el ERP"}, "no está configurada en el ERP"),
    (404, {"error": "Not found"}, "no hay un ERP con la integración"),
    (500, {"error": "stack trace interno"}, "respondió con un error (500)"),
    (302, {}, "redirige"),
])
async def test_a_rejection_explains_why(server, status, payload, expected):
    server.reply = lambda request: httpx.Response(status, json=payload)

    reply = await erp.post_appointment("https://erp.example", "t", FORM, None)

    assert reply.ok is False
    assert expected in reply.error
    assert "stack trace" not in reply.error


async def test_an_unexpected_success_body_is_an_error(server):
    server.reply = lambda request: httpx.Response(200, text="<html>login</html>")

    reply = await erp.post_appointment("https://erp.example", "t", FORM, None)

    assert reply.ok is False
    assert "inesperado" in reply.error


async def test_network_failures_never_raise(server):
    def timeout(request):
        raise httpx.ReadTimeout("lento", request=request)

    def refused(request):
        raise httpx.ConnectError("https://erp.example/secreto?token=abc", request=request)

    server.reply = timeout
    assert (await erp.post_appointment("https://erp.example", "t", FORM, None)).error == "El ERP no respondió a tiempo"
    server.reply = refused
    reply = await erp.post_appointment("https://erp.example", "t", FORM, None)
    assert reply.error == "No se pudo conectar con el ERP"


async def test_ping_checks_address_and_token_without_creating_anything(server):
    server.reply = lambda request: httpx.Response(200, json={"data": {"ok": True}})

    assert (await erp.ping("https://erp.example/", "secreto")).ok is True
    [request] = server.requests
    assert (request.method, str(request.url)) == ("GET", "https://erp.example/api/integrations/crm/ping")
    assert request.headers["authorization"] == "Bearer secreto"


async def test_ping_rejects_a_site_that_is_not_the_erp(server):
    server.reply = lambda request: httpx.Response(200, text="<html>otra cosa</html>")
    assert "no hay un ERP" in (await erp.ping("https://otro.example", "t")).error

    server.reply = lambda request: httpx.Response(401, json={"error": "Token de integración inválido"})
    assert "rechazó el token" in (await erp.ping("https://erp.example", "malo")).error
