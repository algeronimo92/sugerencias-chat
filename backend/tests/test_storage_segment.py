"""La carpeta de un negocio en el almacenamiento no puede depender de su nombre.

El nombre viaja en la ruta solo para reconocer el negocio en la consola de
MinIO. Lo que la hace única e inmutable es el UUID, y el segmento completo se
guarda una vez en `organizations.storage_prefix`: si se recalculara desde el
nombre actual, renombrar un negocio dejaría inalcanzable todo lo que subió antes.
"""

from uuid import UUID

import pytest

from tenancy.context import (
    TenantContext,
    build_storage_segment,
    validate_storage_segment,
)


ORGANIZATION_ID = UUID("21675109-e8d5-453b-83e3-6e9815095ee4")
SCHEMA = "tenant_21675109e8d5453b83e36e9815095ee4"


def _context(storage_segment: str | None) -> TenantContext:
    return TenantContext(ORGANIZATION_ID, SCHEMA, "dermicapro.localhost", storage_segment)


def test_arma_el_segmento_con_uuid_y_nombre():
    assert build_storage_segment(ORGANIZATION_ID, "DermicaPro") == (
        "21675109-e8d5-453b-83e3-6e9815095ee4-dermicapro"
    )


@pytest.mark.parametrize(
    "nombre, esperado",
    [
        ("Clínica Núñez", "clinica-nunez"),  # sin acentos ni eñes en la clave S3
        ("  Spa   Belleza  ", "spa-belleza"),  # espacios colapsados
        ("Estética & Salud!", "estetica-salud"),  # sin signos
        ("A" * 80, "a" * 40),  # recortado
    ],
)
def test_normaliza_el_nombre(nombre, esperado):
    segmento = build_storage_segment(ORGANIZATION_ID, nombre)
    assert segmento == f"{ORGANIZATION_ID}-{esperado}"
    validate_storage_segment(segmento)


def test_un_nombre_sin_letras_deja_solo_el_uuid():
    """El nombre es decorativo: si no queda nada usable, el UUID alcanza."""
    assert build_storage_segment(ORGANIZATION_ID, "***") == str(ORGANIZATION_ID)


@pytest.mark.parametrize(
    "segmento",
    [
        "../otro-negocio",
        "21675109-e8d5-453b-83e3-6e9815095ee4/extra",
        "no-es-un-uuid-dermicapro",
        "21675109-e8d5-453b-83e3-6e9815095ee4-MAYUS",
    ],
)
def test_rechaza_segmentos_que_no_son_una_carpeta_valida(segmento):
    with pytest.raises(ValueError):
        validate_storage_segment(segmento)


def test_el_contexto_expone_la_carpeta_guardada():
    guardado = "21675109-e8d5-453b-83e3-6e9815095ee4-dermicapro"
    assert _context(guardado).storage_path == guardado


def test_sin_segmento_guardado_cae_al_uuid():
    """Negocios anteriores a la columna: sus archivos siguen donde estaban."""
    assert _context(None).storage_path == str(ORGANIZATION_ID)


def test_renombrar_el_negocio_no_mueve_la_carpeta():
    """El escenario que justifica guardar el segmento en vez de derivarlo."""
    guardado = build_storage_segment(ORGANIZATION_ID, "DermicaPro")

    # El admin renombra el negocio en el CRM; el contexto sigue trayendo el
    # segmento que se guardó al aprovisionar, no uno recalculado.
    assert _context(guardado).storage_path == guardado
    assert build_storage_segment(ORGANIZATION_ID, "Dermicapro Lima") != guardado
