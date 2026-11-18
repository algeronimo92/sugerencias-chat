"""El orden de los adjuntos de una plantilla: el texto viaja como pie del
primero que lo admite, así que el orden elegido cambia el mensaje."""

import pytest

from app.modules.catalogs.template_validation import TemplateValidationError, attachment_positions


def test_each_attachment_takes_its_place_in_the_new_order():
    assert attachment_positions([10, 11, 12], [12, 10, 11]) == {12: 0, 10: 1, 11: 2}


@pytest.mark.parametrize("requested", [
    [10, 11],          # otra pestaña agregó uno
    [10, 11, 12, 13],  # otra pestaña borró uno
    [10, 10, 11],      # repetido: dos en la misma posición
    [10, 11, 99],      # de otra plantilla
])
def test_rejects_an_order_that_does_not_name_each_attachment_once(requested):
    with pytest.raises(TemplateValidationError, match="cambiaron mientras los ordenabas"):
        attachment_positions([10, 11, 12], requested)


def test_the_order_route_requires_an_admin():
    from app.modules.catalogs.templates_api import put_attachment_order
    import inspect

    guard = inspect.signature(put_attachment_order).parameters["_admin"].default
    from app.modules.auth.ports.auth_service import require_admin
    assert guard.dependency is require_admin
