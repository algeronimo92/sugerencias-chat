"""Consumer contract: only the operations used outside this capability."""

from app.modules.catalogs.template_validation import (
    render_official_body,
    template_parameter_identifiers,
)

__all__ = ['render_official_body', 'template_parameter_identifiers']
