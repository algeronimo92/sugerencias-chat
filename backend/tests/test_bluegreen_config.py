"""Garantías del despliegue blue-green que fallan en silencio.

Ninguna de estas rompe un despliegue de forma visible: el sitio sigue
cargando. Lo que se rompe es la exposición a Internet o la capacidad de
conmutar, y de eso uno se entera tarde.
"""

import json
import os
import shutil
import subprocess
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parent.parent.parent
ACTIVE = ROOT / "traefik" / "dynamic" / "active.yml"
SCRIPT = ROOT / "scripts" / "deploy-bluegreen.sh"

PORTS = {"blue": 8081, "green": 8082}


def _compose_config(color_port: int) -> dict:
    # Se hereda el entorno completo y sólo se añade COLOR_PORT: con un entorno
    # mínimo, docker no encuentra su configuración en Windows y estos tests se
    # saltaban en silencio — justo los que comprueban que el backend no queda
    # expuesto.
    env = dict(os.environ, COLOR_PORT=str(color_port))
    result = subprocess.run(
        ["docker", "compose",
         "-p", "test-bluegreen",
         "-f", str(ROOT / "compose.prod.yml"),
         "-f", str(ROOT / "compose.bluegreen.yml"),
         "config", "--format", "json"],
        capture_output=True, text=True, env=env,
    )
    if result.returncode != 0:
        pytest.skip(f"docker compose no disponible: {result.stderr[:150]}")
    return json.loads(result.stdout)


def _sandbox(tmp_path: Path) -> Path:
    """Copia el script y el archivo activo a un directorio temporal.

    Se trabaja con rutas relativas dentro de él en vez de pasar rutas
    absolutas a bash: los distintos bash de Windows (Git, MSYS, WSL) traducen
    "C:\\..." de formas incompatibles, y el test acabaría comprobando la
    traducción de rutas en vez de la lógica de conmutación.
    """
    shutil.copy2(SCRIPT, tmp_path / "deploy-bluegreen.sh")
    shutil.copy2(ACTIVE, tmp_path / "active.yml")
    return tmp_path


def _bash() -> str | None:
    """Un bash que sepa hacer `source` de verdad.

    En Windows, `shutil.which("bash")` suele encontrar el bash MSYS de Git
    (usr/bin/bash.exe), donde el `source` de este script no llega a definir su
    array asociativo. El de Git Bash (bin/bash.exe) sí, y es el que usan tanto
    el desarrollador como el servidor.
    """
    for candidate in (
        r"C:\Program Files\Git\bin\bash.exe",
        r"C:\Program Files (x86)\Git\bin\bash.exe",
    ):
        if Path(candidate).exists():
            return candidate
    return shutil.which("bash")


def _run_bash(sandbox: Path, snippet: str) -> subprocess.CompletedProcess:
    executable = _bash()
    if executable is None:
        pytest.skip("no hay bash disponible")
    result = subprocess.run(
        [executable, "-c",
         f'source ./deploy-bluegreen.sh; ACTIVE_FILE=./active.yml; {snippet}'],
        cwd=sandbox, capture_output=True, text=True,
    )
    return result


requires_docker = pytest.mark.skipif(
    shutil.which("docker") is None, reason="requiere docker"
)
requires_bash = pytest.mark.skipif(
    shutil.which("bash") is None, reason="requiere bash"
)


@requires_docker
def test_backend_is_not_published() -> None:
    """Publicar el backend dejaría la API accesible saltándose nginx."""
    config = _compose_config(8081)
    assert config["services"]["backend"].get("ports", []) == []


@requires_docker
def test_frontend_is_bound_to_loopback_only() -> None:
    """Sin el 127.0.0.1, cualquiera entraría por el puerto del color y se
    saltaría traefik — es decir, el TLS."""
    config = _compose_config(8081)
    ports = config["services"]["frontend"]["ports"]
    assert len(ports) == 1
    assert ports[0]["host_ip"] == "127.0.0.1"
    assert ports[0]["published"] == "8081"


@requires_docker
def test_docker_routing_is_disabled_for_colors() -> None:
    """Si traefik descubriera los colores por etiquetas además de por el
    archivo, ambos reclamarían el mismo Host y el enrutado sería una lotería."""
    config = _compose_config(8081)
    labels = config["services"]["frontend"].get("labels", {})
    assert labels.get("traefik.enable") == "false"


def test_active_file_is_valid_traefik_config() -> None:
    document = yaml.safe_load(ACTIVE.read_text(encoding="utf-8"))
    router = document["http"]["routers"]["sugerencias-chat"]
    service = document["http"]["services"]["sugerencias-chat"]["loadBalancer"]

    assert router["entryPoints"] == ["websecure"]
    assert router["tls"]["certResolver"] == "letsencrypt"
    assert "chat.dermicapro.app" in router["rule"]
    assert router["service"] == "sugerencias-chat"

    url = service["servers"][0]["url"]
    assert url in [f"http://127.0.0.1:{port}" for port in PORTS.values()], url


def test_active_file_points_at_a_known_color() -> None:
    """El comentario ACTIVE_COLOR y el puerto tienen que contar lo mismo: es
    de donde el script deduce qué color está sirviendo."""
    text = ACTIVE.read_text(encoding="utf-8")
    declared = next(
        line.split(":")[1].strip()
        for line in text.splitlines()
        if line.startswith("# ACTIVE_COLOR:")
    )
    url = yaml.safe_load(text)["http"]["services"]["sugerencias-chat"]["loadBalancer"]["servers"][0]["url"]
    assert url.endswith(str(PORTS[declared])), (
        f"el comentario dice {declared} pero el puerto es {url}"
    )


@requires_bash
@pytest.mark.parametrize("color", ["blue", "green"])
def test_switching_preserves_the_routing_rule(tmp_path, color: str) -> None:
    """Conmutar de color no puede perder el Host ni el certResolver: sería un
    despliegue que deja el dominio sin certificado."""
    sandbox = _sandbox(tmp_path)

    result = _run_bash(sandbox, f"write_active {color}")
    assert result.returncode == 0, result.stderr

    document = yaml.safe_load((sandbox / "active.yml").read_text(encoding="utf-8"))
    router = document["http"]["routers"]["sugerencias-chat"]
    url = document["http"]["services"]["sugerencias-chat"]["loadBalancer"]["servers"][0]["url"]

    assert url == f"http://127.0.0.1:{PORTS[color]}"
    assert router["tls"]["certResolver"] == "letsencrypt"
    assert "chat.dermicapro.app" in router["rule"]


@requires_bash
def test_active_color_round_trips(tmp_path) -> None:
    """Lo que el script escribe tiene que ser lo que el script lee después."""
    sandbox = _sandbox(tmp_path)

    for color in ("green", "blue", "green"):
        result = _run_bash(sandbox, f"write_active {color} >/dev/null; active_color")
        assert result.returncode == 0, result.stderr
        assert result.stdout.strip() == color


@requires_bash
def test_the_two_colors_never_share_a_port(tmp_path) -> None:
    """Si coincidieran, el segundo color no podría levantar y el despliegue
    quedaría bloqueado sin explicación."""
    result = _run_bash(
        _sandbox(tmp_path),
        'for c in "${!PORT[@]}"; do echo "$c ${PORT[$c]}"; done',
    )
    assert result.returncode == 0, result.stderr
    ports = dict(line.split() for line in result.stdout.split("\n") if line.strip())
    assert set(ports) == {"blue", "green"}
    assert len(set(ports.values())) == 2, ports


@requires_bash
def test_stop_legacy_stack_removes_only_the_legacy_project(tmp_path) -> None:
    """Regresión: el stack anterior a blue-green quedó levantado en el
    servidor y, como traefik enruta también por etiquetas, servía él el
    dominio. Los despliegues construían, migraban y conmutaban de color sin
    que nadie llegara a ver la versión nueva."""
    result = _run_bash(
        _sandbox(tmp_path),
        'docker() { echo "$*" >> calls.txt; if [ "$1" = ps ]; then echo cafe1; fi; }; '
        "stop_legacy_stack",
    )
    assert result.returncode == 0, result.stderr

    calls = (tmp_path / "calls.txt").read_text(encoding="utf-8")
    assert "--filter label=com.docker.compose.project=sugerencias-chat\n" in calls
    assert "rm -f cafe1" in calls
    # El filtro es de igualdad exacta; los colores son otro proyecto.
    assert "sugerencias-chat-green" not in calls
    assert "sugerencias-chat-blue" not in calls


@requires_bash
def test_stop_legacy_stack_removes_nothing_when_it_is_not_running(tmp_path) -> None:
    """Lo normal a partir de ahora: no hay heredado que parar."""
    result = _run_bash(
        _sandbox(tmp_path),
        'docker() { echo "$*" >> calls.txt; }; stop_legacy_stack',
    )
    assert result.returncode == 0, result.stderr
    assert "rm -f" not in (tmp_path / "calls.txt").read_text(encoding="utf-8")


@requires_bash
def test_traefik_check_rejects_another_container_answering_the_domain(tmp_path) -> None:
    """Comprobar sólo que el dominio devuelve 200 daba por bueno un despliegue
    que servía otro contenedor. Ahora se compara con lo que devuelve el propio
    color recién desplegado."""
    stub = (
        'curl() { case "$*" in *127.0.0.1:8082/*) echo color-nuevo;; '
        "*) echo otro-contenedor;; esac; }; "
    )
    result = _run_bash(_sandbox(tmp_path), f"{stub} serving_through_traefik green")
    assert result.returncode != 0, "el despliegue se habría dado por bueno"


@requires_bash
def test_traefik_check_accepts_the_color_it_just_deployed(tmp_path) -> None:
    result = _run_bash(
        _sandbox(tmp_path),
        'curl() { echo color-nuevo; }; serving_through_traefik green',
    )
    assert result.returncode == 0, result.stderr


@requires_bash
@pytest.mark.parametrize("color", ["blue", "green"])
def test_compose_for_embeds_color_port_for_every_subcommand(tmp_path, color: str) -> None:
    """Regresión: compose.bluegreen.yml exige COLOR_PORT para interpolar el
    puerto del color, y ese error ocurre al parsear el archivo — esto rompió
    scripts.migrate en producción porque esa invocación de compose_for no
    llevaba el prefijo COLOR_PORT=... a mano como sí lo llevaba "up".
    Embeberlo dentro de compose_for hace que cualquier subcomando (up, run,
    exec, logs, down, ps) lo tenga siempre, sin depender de que cada call
    site se acuerde de prefijarlo."""
    result = _run_bash(_sandbox(tmp_path), f'compose_for {color}')
    assert result.returncode == 0, result.stderr
    assert f"COLOR_PORT={PORTS[color]}" in result.stdout
