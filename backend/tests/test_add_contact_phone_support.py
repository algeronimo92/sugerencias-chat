import copy
import importlib.util
import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest


SCRIPT_PATH = Path(__file__).resolve().parents[2] / "scripts" / "add_contact_phone_support.py"
SPEC = importlib.util.spec_from_file_location("add_contact_phone_support", SCRIPT_PATH)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)
update_workflow = MODULE.update_workflow

# El payload que hoy escribe el nodo: solo el nombre, y con el ad_referral que
# inyecta inject_ad_referral.py alrededor.
LEGACY_PAYLOAD = (
    "={{ (() => { /*ADREF*/ const base = ({ contacts: [{ fullName: "
    "(($json.body.data.message || {}).contactMessage || {}).displayName || 'sin nombre' }] }); "
    "let ad = null; (function find(o){ if (!o || typeof o !== 'object' || ad) return; "
    "if (o.externalAdReply) { ad = o.externalAdReply; return; } for (const k in o) find(o[k]); "
    "})(($json.body || {}).data || {}); const adref = ad ? { ad_referral: { title: ad.title || null } } : null; "
    "if (base == null && adref == null) return null; "
    "return Object.assign({}, base || {}, adref || {}); })() }}"
)

VCARD = (
    "BEGIN:VCARD\\nVERSION:3.0\\nN:;;;;\\nFN:Alger Pier Nuevo 1\\n"
    "item1.TEL;waid=51906471403:+51 906 471 403\\nitem1.X-ABLabel:Celular\\n"
    "PHOTO;BASE64:/9j/4AAQSkZJRgABAQAAAQABAAD\\nEND:VCARD"
)


def _workflow() -> dict:
    return {
        "nodes": [
            {
                "name": "contact content",
                "type": "n8n-nodes-base.set",
                "typeVersion": 3.4,
                "parameters": {
                    "assignments": {
                        "assignments": [
                            {"id": "a", "name": "content", "value": "={{ null }}", "type": "string"},
                            {"id": "b", "name": "message_type", "value": "contact", "type": "string"},
                            {"id": "c", "name": "payload", "value": LEGACY_PAYLOAD, "type": "object"},
                        ]
                    }
                },
            }
        ]
    }


def _payload_expression(workflow: dict) -> str:
    node = next(n for n in workflow["nodes"] if n["name"] == "contact content")
    return next(
        a for a in node["parameters"]["assignments"]["assignments"] if a["name"] == "payload"
    )["value"]


def _run_expression(workflow: dict, message: dict) -> dict:
    """Evalúa la expresión generada con Node, como hace n8n al ejecutar el Set."""
    node_bin = shutil.which("node")
    if node_bin is None:
        pytest.skip("Node no está disponible para evaluar la expresión")
    expression = _payload_expression(workflow).strip()[3:-2].strip()
    event = {"body": {"data": {"message": message, "messageType": "contactMessage"}}}
    script = f"const $json = {json.dumps(event)};\nconsole.log(JSON.stringify({expression}));"
    result = subprocess.run(
        [node_bin, "-e", script], capture_output=True, text=True, check=True, timeout=30
    )
    return json.loads(result.stdout)


def test_extrae_el_telefono_del_vcard_y_conserva_el_ad_referral():
    workflow = _workflow()
    assert update_workflow(workflow) is True

    expression = _payload_expression(workflow)
    assert "phoneNumber" in expression
    assert "/*ADREF*/" in expression and "ad_referral" in expression
    # Dos llaves seguidas cerrarían la expresión de n8n antes de tiempo.
    assert "}}" not in expression[:-2]


def test_es_idempotente():
    workflow = _workflow()
    update_workflow(workflow)
    once = copy.deepcopy(workflow)
    assert update_workflow(workflow) is False
    assert workflow == once


def test_falla_si_el_nodo_no_existe():
    with pytest.raises(ValueError, match="contact content"):
        update_workflow({"nodes": []})


def test_la_expresion_resuelve_el_contacto_real_de_android():
    workflow = _workflow()
    update_workflow(workflow)
    payload = _run_expression(workflow, {
        "contactMessage": {"displayName": "Alger Pier Nuevo 1", "vcard": VCARD.replace("\\n", "\n")},
    })
    assert payload["contacts"] == [{"fullName": "Alger Pier Nuevo 1", "phoneNumber": "51906471403"}]


def test_la_expresion_mapea_el_array_de_contactos():
    workflow = _workflow()
    update_workflow(workflow)
    payload = _run_expression(workflow, {
        "contactsArrayMessage": {"contacts": [
            {"displayName": "Ana", "vcard": "BEGIN:VCARD\nitem1.TEL;waid=51999888777:999 888 777\nEND:VCARD"},
            # Sin waid: queda el TEL visible, tal cual lo mandó el remitente.
            {"displayName": "Beto", "vcard": "BEGIN:VCARD\nTEL;type=CELL:987 654 321\nEND:VCARD"},
            # Sin vCard: el contacto igual se muestra, pero sin número.
            {"displayName": "Caro"},
        ]},
    })
    assert payload["contacts"] == [
        {"fullName": "Ana", "phoneNumber": "51999888777"},
        {"fullName": "Beto", "phoneNumber": "987 654 321"},
        {"fullName": "Caro", "phoneNumber": None},
    ]


def test_no_guarda_la_foto_del_vcard():
    workflow = _workflow()
    update_workflow(workflow)
    payload = _run_expression(workflow, {
        "contactMessage": {"displayName": "Alger", "vcard": VCARD.replace("\\n", "\n")},
    })
    assert not re.search("BASE64|PHOTO", json.dumps(payload))
