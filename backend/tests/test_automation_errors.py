"""Los errores de las automatizaciones son de dominio: la API no elige el
status por ruta."""

import pytest

from app.modules.automations.domain.errors import MALFORMED_INPUT, InvalidAutomation
from app.modules.automations.domain.validation import normalize_rule


def test_a_malformed_rule_is_an_invalid_input_not_a_server_error():
    with pytest.raises(InvalidAutomation) as caught:
        normalize_rule({"name": "x", "trigger_type": "lead_created", "actions": [{"type": "add_tag", "tag_id": [1]}]})

    assert caught.value.status_code == 400
    # El texto del TypeError describe el código, no la regla.
    assert caught.value.detail == MALFORMED_INPUT


def test_a_rule_violation_keeps_its_message():
    with pytest.raises(InvalidAutomation) as caught:
        normalize_rule({"name": "x", "trigger_type": "lead_created", "actions": 5})

    assert caught.value.status_code == 400
    assert "acciones" in caught.value.detail
