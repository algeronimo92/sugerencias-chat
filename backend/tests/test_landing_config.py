"""Garantías de la landing (cliniventas.com) que fallan en silencio.

La landing es un contenedor aparte (compose.landing.yml) detrás del mismo
traefik que el CRM. Nada de esto rompe un despliegue de forma visible: lo que
se rompe es a quién le llega `www`, la exposición del puerto a Internet o qué
versión queda publicada.
"""

import re
import shutil
import subprocess
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parent.parent.parent
COMPOSE = ROOT / "compose.landing.yml"
ROUTER = ROOT / "traefik" / "dynamic" / "landing.yml"
ACTIVE = ROOT / "traefik" / "dynamic" / "active.yml"
SCRIPT = ROOT / "scripts" / "deploy-landing.sh"

# Puertos de loopback que ya usa el CRM (colores y sus métricas,
# scripts/deploy-bluegreen.sh).
CRM_PORTS = {8081, 8082, 9081, 9082}

requires_bash = pytest.mark.skipif(
    shutil.which("bash") is None, reason="requiere bash"
)


def _router() -> dict:
    return yaml.safe_load(ROUTER.read_text(encoding="utf-8"))["http"]


def _crm_router() -> dict:
    return yaml.safe_load(ACTIVE.read_text(encoding="utf-8"))["http"]["routers"]["sugerencias-chat"]


def _hosts(rule: str) -> list[str]:
    return re.findall(r"Host\(`([^`]+)`\)", rule)


def _published_ports() -> list[str]:
    return yaml.safe_load(COMPOSE.read_text(encoding="utf-8"))["services"]["landing"]["ports"]


def test_landing_is_bound_to_loopback_only() -> None:
    """Sin el 127.0.0.1, cualquiera entraría por el puerto del contenedor y se
    saltaría traefik — es decir, el TLS."""
    ports = _published_ports()
    assert ports, "traefik no tendría a dónde mandar el tráfico"
    for port in ports:
        assert port.startswith("127.0.0.1:"), port


def test_traefik_points_at_the_port_the_container_publishes() -> None:
    """Son dos archivos distintos y nada los ata: cambiar el puerto en uno
    solo deja el dominio respondiendo 502."""
    url = _router()["services"]["landing"]["loadBalancer"]["servers"][0]["url"]
    published = {int(port.split(":")[1]) for port in _published_ports()}
    assert url.startswith("http://127.0.0.1:")
    assert int(url.rsplit(":", 1)[1]) in published


def test_landing_does_not_take_a_port_of_the_crm() -> None:
    """El segundo en levantar no podría atar el puerto: o la landing no
    arranca, o un color del CRM no puede desplegarse."""
    published = {int(port.split(":")[1]) for port in _published_ports()}
    assert not published & CRM_PORTS


def test_landing_router_serves_the_root_domain_and_www() -> None:
    router = _router()["routers"]["landing"]
    assert router["entryPoints"] == ["websecure"]
    assert router["service"] == "landing"
    assert router["tls"]["certResolver"] == "letsencrypt"
    assert set(_hosts(router["rule"])) == {"cliniventas.com", "www.cliniventas.com"}


def test_www_goes_to_the_landing_and_not_to_the_crm() -> None:
    """`www.cliniventas.com` encaja también en la HostRegexp de los negocios.
    Traefik desempata por prioridad y, sin una explícita, por el largo de la
    regla: la landing ganaba por un puñado de caracteres. Si gana el CRM,
    `www` responde "negocio no encontrado"."""
    crm = _crm_router()
    pattern = re.compile(re.fullmatch(r"HostRegexp\(`([^`]+)`\)", crm["rule"]).group(1))
    assert pattern.fullmatch("www.cliniventas.com"), "si ya no chocan, este test sobra"

    landing = _router()["routers"]["landing"]
    # La prioridad por defecto de traefik es el largo de la regla.
    crm_priority = crm.get("priority", len(crm["rule"]))
    assert landing["priority"] > crm_priority


def test_every_landing_host_has_a_certificate() -> None:
    """Con `tls.domains` explícito, traefik pide solo lo que se lista: un
    host del router que nadie certifica se sirve con el certificado por
    defecto y el navegador lo rechaza. Un wildcard no cubre el dominio al que
    pertenece, así que el raíz tiene que estar pedido por nombre."""
    names = [
        name
        for router in (_router()["routers"]["landing"], _crm_router())
        for entry in router["tls"]["domains"]
        for name in (entry["main"], *entry.get("sans", []))
    ]

    def covered(host: str) -> bool:
        return any(
            name == host or (name.startswith("*.") and host.split(".", 1)[1] == name[2:])
            for name in names
        )

    for host in _hosts(_router()["routers"]["landing"]["rule"]):
        assert covered(host), f"{host}: ningún certificado lo cubre"


def test_landing_images_are_pinned() -> None:
    """Un tag flotante cambia nginx o Node en un despliegue que no tocó nada
    de la landing."""
    dockerfile = (ROOT / "landing" / "Dockerfile").read_text(encoding="utf-8")
    images = re.findall(r"^FROM\s+(\S+)", dockerfile, flags=re.MULTILINE)
    assert images
    for image in images:
        assert re.fullmatch(r"[a-z/]+:\d+\.\d+\.\d+-alpine\d+\.\d+", image), image


def test_deploy_runs_the_landing_script_without_rolling_back_the_crm() -> None:
    """El despliegue tiene que pasar por el script (prueba la imagen antes de
    publicarla) y un fallo de la landing no puede caer en la rama que
    devuelve el CRM al commit anterior."""
    workflow = (ROOT / ".github" / "workflows" / "deploy.yml").read_text(encoding="utf-8")
    assert "./scripts/deploy-landing.sh || LANDING_OK=0" in workflow
    success_branch = workflow.split('echo "Despliegue verificado"', 1)[1].split(
        'echo "El despliegue no llegó a conmutar', 1
    )[0]
    assert "deploy-landing.sh" in success_branch
    assert 'if [ "$LANDING_OK" != 1 ]; then' in success_branch


def _sandbox(tmp_path: Path, *, fail_on: str | None = None) -> str:
    """Copia el script y pone un `docker` de mentira en el PATH, que anota
    cada llamada y falla si sus argumentos contienen ``fail_on``. compose()
    ejecuta docker a través de `env`, así que una función de bash no lo
    reemplazaría."""
    shutil.copy2(SCRIPT, tmp_path / "deploy-landing.sh")
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    fake = bin_dir / "docker"
    fail = f'case "$*" in *"{fail_on}"*) exit 1;; esac\n' if fail_on else ""
    fake.write_text(
        f'#!/usr/bin/env bash\necho "$*" >> "{tmp_path}/calls.txt"\n{fail}exit 0\n',
        encoding="utf-8",
    )
    fake.chmod(0o755)
    return (
        f'source ./deploy-landing.sh; PATH="{bin_dir}:$PATH"; '
        "READY_ATTEMPTS=1; READY_INTERVAL=0; TRAEFIK_ATTEMPTS=1; TRAEFIK_INTERVAL=0; "
        "revision() { echo nueva; }; "
    )


def _run(tmp_path: Path, snippet: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["bash", "-c", snippet], cwd=tmp_path, capture_output=True, text=True
    )


def _calls(tmp_path: Path) -> list[str]:
    calls = tmp_path / "calls.txt"
    return calls.read_text(encoding="utf-8").splitlines() if calls.exists() else []


@requires_bash
def test_unchanged_landing_is_not_rebuilt(tmp_path) -> None:
    """Cada push a `main` pasa por acá. Reconstruir y recrear la landing en
    cada despliegue del CRM sería un corte por nada."""
    setup = _sandbox(tmp_path)
    result = _run(tmp_path, setup + "serving_revision() { echo nueva; }; cmd_deploy")

    assert result.returncode == 0, result.stderr
    calls = _calls(tmp_path)
    assert not any(" build" in call for call in calls), calls
    assert not any(call.startswith("run ") for call in calls), calls
    # `up` sí: aplica cambios de compose.landing.yml y, sin ellos, no recrea.
    assert any(call.endswith("up -d --wait") for call in calls), calls


@requires_bash
def test_a_landing_that_fails_its_checks_is_never_published(tmp_path) -> None:
    """La imagen nueva se prueba en un contenedor aparte. Si no responde
    como se espera, el que sirve no se toca y el candidato no queda vivo."""
    setup = _sandbox(tmp_path)
    result = _run(
        tmp_path,
        setup
        + "serving_revision() { echo vieja; }; wait_ready() { return 0; }; "
        + "smoke() { return 1; }; cmd_deploy",
    )

    assert result.returncode == 1
    assert "No se reemplaza" in result.stderr
    calls = _calls(tmp_path)
    assert any(call.endswith("build") for call in calls), calls
    assert any(
        call.startswith("run -d --name cliniventas-landing-candidato -p 127.0.0.1:8091:80 cliniventas-landing:nueva")
        for call in calls
    ), calls
    assert not any(" up " in call for call in calls), calls
    assert calls[-1] == "rm -f cliniventas-landing-candidato"


@requires_bash
def test_a_landing_that_breaks_after_the_swap_goes_back(tmp_path) -> None:
    """El candidato pasó, pero en su puerto definitivo no responde: se vuelve
    a levantar la revisión que servía, cuya imagen sigue en el servidor."""
    setup = _sandbox(tmp_path)
    result = _run(
        tmp_path,
        setup
        + "serving_revision() { echo vieja; }; wait_ready() { return 0; }; "
        + 'smoke() { [ "$1" = 8091 ]; }; cmd_deploy',
    )

    assert result.returncode == 1
    assert "Volviendo a la versión vieja" in result.stderr
    ups = [call for call in _calls(tmp_path) if call.endswith("up -d --wait")]
    assert len(ups) == 2, ups


@requires_bash
def test_published_landing_keeps_the_previous_image_for_rollback(tmp_path) -> None:
    """Tras un despliegue bueno quedan dos imágenes: la que sirve y la
    anterior. Las demás se borran para no llenar el disco del servidor."""
    setup = _sandbox(tmp_path)
    result = _run(
        tmp_path,
        setup
        + "serving_revision() { echo vieja; }; wait_ready() { return 0; }; smoke() { return 0; }; "
        + "wait_serving_through_traefik() { return 0; }; "
        + 'docker() { if [ "$1" = images ]; then printf "nueva\\nvieja\\nantigua\\n"; else command docker "$@"; fi; }; '
        + "cmd_deploy",
    )

    assert result.returncode == 0, result.stderr
    removed = [call for call in _calls(tmp_path) if call.startswith("rmi ")]
    assert removed == ["rmi cliniventas-landing:antigua"]


@requires_bash
def test_traefik_check_rejects_the_crm_answering_www(tmp_path) -> None:
    """El dominio raíz llega a la landing pero `www` cae en el router de los
    negocios: no redirige al raíz. El despliegue no puede darse por bueno."""
    setup = _sandbox(tmp_path)
    stub = (
        'curl() { case "$*" in *redirect_url*) echo "";; *) echo landing;; esac; }; '
    )
    result = _run(tmp_path, setup + stub + "serving_through_traefik")
    assert result.returncode != 0


@requires_bash
def test_traefik_check_rejects_another_container_answering_the_domain(tmp_path) -> None:
    setup = _sandbox(tmp_path)
    stub = (
        'curl() { case "$*" in *redirect_url*) echo "https://cliniventas.com/";; '
        "*127.0.0.1:8090/*) echo landing;; *) echo otro-contenedor;; esac; }; "
    )
    result = _run(tmp_path, setup + stub + "serving_through_traefik")
    assert result.returncode != 0


@requires_bash
def test_traefik_check_accepts_the_landing_on_both_hosts(tmp_path) -> None:
    setup = _sandbox(tmp_path)
    stub = (
        'curl() { case "$*" in *redirect_url*) echo "https://cliniventas.com/";; '
        "*) echo landing;; esac; }; "
    )
    result = _run(tmp_path, setup + stub + "serving_through_traefik")
    assert result.returncode == 0, result.stderr
