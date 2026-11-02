"""Plantillas interactivas con el subtipo y la estructura de Meta.

Revision ID: d4b8e1f3a6c2
Revises: c7e2f9a4d1b8

``interactive_type = 'buttons'`` pasa a ``'button'`` (el literal de Meta) y
``interactive_config`` deja los nombres de la integración anterior
(``displayText``, ``rowId``, ``buttonText``, ``footerText``) por el objeto
``interactive`` de Meta sin ``type`` ni ``body``:

- botones: ``{header, footer, action: {buttons: [{type: reply, reply: {id, title}}]}}``
- lista: ``{header, footer, action: {button, sections: [{title, rows: [{id, title, description}]}]}}``

Un botón que no es de respuesta (URL, llamada, copiar código) no existe en un
interactivo de Meta: la plantilla que lo tenga queda inactiva con solo sus
botones de respuesta, para que un administrador la revise.
"""

from typing import Sequence, Union

from alembic import op


revision: str = "d4b8e1f3a6c2"
down_revision: Union[str, None] = "c7e2f9a4d1b8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        UPDATE message_templates
        SET is_active = false
        WHERE interactive_type = 'buttons'
          AND EXISTS (
              SELECT 1 FROM jsonb_array_elements(COALESCE(interactive_config -> 'buttons', '[]'::jsonb)) AS b
              WHERE b ->> 'type' IS DISTINCT FROM 'reply'
          )
        """
    )
    op.execute(
        """
        UPDATE message_templates
        SET interactive_type = 'button',
            interactive_config = jsonb_strip_nulls(jsonb_build_object(
                'header', CASE WHEN NULLIF(interactive_config ->> 'title', '') IS NOT NULL
                    THEN jsonb_build_object('type', 'text', 'text', interactive_config ->> 'title') END,
                'footer', CASE WHEN NULLIF(interactive_config ->> 'footer', '') IS NOT NULL
                    THEN jsonb_build_object('text', interactive_config ->> 'footer') END,
                'action', jsonb_build_object('buttons', COALESCE((
                    SELECT jsonb_agg(jsonb_build_object(
                        'type', 'reply',
                        'reply', jsonb_build_object('id', b ->> 'id', 'title', b ->> 'displayText')
                    ) ORDER BY position)
                    FROM jsonb_array_elements(COALESCE(interactive_config -> 'buttons', '[]'::jsonb))
                        WITH ORDINALITY AS item(b, position)
                    WHERE b ->> 'type' = 'reply'
                ), '[]'::jsonb))
            ))
        WHERE interactive_type = 'buttons'
        """
    )
    op.execute(
        """
        UPDATE message_templates
        SET interactive_config = jsonb_strip_nulls(jsonb_build_object(
                'header', CASE WHEN NULLIF(interactive_config ->> 'title', '') IS NOT NULL
                    THEN jsonb_build_object('type', 'text', 'text', interactive_config ->> 'title') END,
                'footer', CASE WHEN NULLIF(interactive_config ->> 'footerText', '') IS NOT NULL
                    THEN jsonb_build_object('text', interactive_config ->> 'footerText') END,
                'action', jsonb_build_object(
                    'button', interactive_config ->> 'buttonText',
                    'sections', COALESCE((
                        SELECT jsonb_agg(jsonb_build_object(
                            'title', s ->> 'title',
                            'rows', COALESCE((
                                SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                                    'id', r ->> 'rowId',
                                    'title', r ->> 'title',
                                    'description', r ->> 'description'
                                )) ORDER BY row_position)
                                FROM jsonb_array_elements(COALESCE(s -> 'rows', '[]'::jsonb))
                                    WITH ORDINALITY AS row_item(r, row_position)
                            ), '[]'::jsonb)
                        ) ORDER BY section_position)
                        FROM jsonb_array_elements(COALESCE(interactive_config -> 'sections', '[]'::jsonb))
                            WITH ORDINALITY AS section_item(s, section_position)
                    ), '[]'::jsonb)
                )
            ))
        WHERE interactive_type = 'list' AND interactive_config ? 'sections'
        """
    )


def downgrade() -> None:
    raise NotImplementedError(
        "d4b8e1f3a6c2 no se revierte: restaurar el respaldo previo a la migración"
    )
