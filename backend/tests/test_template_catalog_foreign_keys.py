from db.models import MessageTemplate


def _only_foreign_key(column_name: str):
    foreign_keys = list(MessageTemplate.__table__.c[column_name].foreign_keys)
    assert len(foreign_keys) == 1
    return foreign_keys[0]


def test_template_category_is_enforced_by_catalog():
    foreign_key = _only_foreign_key("category")

    assert foreign_key.target_fullname == "template_categories.name"
    assert foreign_key.onupdate == "CASCADE"
    assert foreign_key.ondelete == "RESTRICT"


def test_template_service_is_enforced_by_catalog():
    foreign_key = _only_foreign_key("service")

    assert foreign_key.target_fullname == "lead_services.name"
    assert foreign_key.onupdate == "CASCADE"
    assert foreign_key.ondelete == "RESTRICT"
