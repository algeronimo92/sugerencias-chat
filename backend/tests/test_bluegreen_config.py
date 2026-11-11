"""Garantías del despliegue blue-green que fallan en silencio.

Ninguna de estas rompe un despliegue de forma visible: el sitio sigue
cargando. Lo que se rompe es la exposición a Internet o la capacidad de
conmutar, y de eso uno se entera tarde.
"""

import json
import os
import re
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
    env = dict(os.environ, COLOR_PORT=str(color_port), METRICS_PORT=str(color_port + 1000))
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
    assert len(ports) == 2
    assert all(port["host_ip"] == "127.0.0.1" for port in ports)
    assert {port["target"]: port["published"] for port in ports} == {80: "8081", 9113: "9081"}


@requires_docker
def test_docker_routing_is_disabled_for_colors() -> None:
    """Si traefik descubriera los colores por etiquetas además de por el
    archivo, ambos reclamarían el mismo Host y el enrutado sería una lotería."""
    config = _compose_config(8081)
    labels = config["services"]["frontend"].get("labels", {})
    assert labels.get("traefik.enable") == "false"


def _assert_tenant_routing(rule: str) -> None:
    match = re.fullmatch(r"HostRegexp\(`([^`]+)`\)", rule)
    assert match is not None, "el router debe cubrir subdominios tenant"
    pattern = re.compile(match.group(1))
    for host in ("dermicapro.cliniventas.com", "negocio-2.cliniventas.com"):
        assert pattern.fullmatch(host), host
    for host in ("cliniventas.com", "otro.example.com", "x.cliniventas.com.evil.com", "a.b.cliniventas.com"):
        assert not pattern.fullmatch(host), host


def test_active_file_is_valid_traefik_config() -> None:
    document = yaml.safe_load(ACTIVE.read_text(encoding="utf-8"))
    router = document["http"]["routers"]["sugerencias-chat"]
    service = document["http"]["services"]["sugerencias-chat"]["loadBalancer"]

    assert router["entryPoints"] == ["websecure"]
    assert router["tls"]["certResolver"] == "letsencrypt"
    _assert_tenant_routing(router["rule"])
    assert router["service"] == "sugerencias-chat"

    url = service["servers"][0]["url"]
    assert url in [f"http://127.0.0.1:{port}" for port in PORTS.values()], url


def test_certificate_domains_can_be_issued() -> None:
    """Traefik no deduce dominios de una HostRegexp: certifica los que lista
    tls.domains. Un wildcard solo se emite por DNS-01 (con HTTP-01 Let's
    Encrypt lo niega en cada arranque), y ningún host certificado puede quedar
    fuera del router, como el dominio raíz, que es la landing y tiene su propio
    router (traefik/dynamic/landing.yml, ver test_landing_config.py)."""
    document = yaml.safe_load(ACTIVE.read_text(encoding="utf-8"))
    router = document["http"]["routers"]["sugerencias-chat"]
    pattern = re.compile(re.fullmatch(r"HostRegexp\(`([^`]+)`\)", router["rule"]).group(1))
    reverse_proxy = (ROOT / "traefik" / "reverse-proxy.docker-compose.yml").read_text(encoding="utf-8")
    dns_challenge = "- --certificatesresolvers.letsencrypt.acme.dnschallenge=true" in reverse_proxy

    hosts = [
        host
        for entry in router["tls"]["domains"]
        for host in (entry["main"], *entry.get("sans", []))
    ]

    def covered(host: str) -> bool:
        # Un wildcard cubre exactamente un nivel, como la regla del router.
        return any(
            name == host or (name.startswith("*.") and host.split(".", 1)[1] == name[2:])
            for name in hosts
        )

    for host in ("dermicapro.cliniventas.com", "admin.cliniventas.com"):
        assert covered(host), f"{host}: ningún certificado lo cubre"
    for host in hosts:
        if "*" in host:
            assert dns_challenge, f"{host}: un wildcard solo se emite por DNS-01"
            # Un nombre concreto en lugar del `*` tiene que ser un host del router.
            host = host.replace("*", "negocio", 1)
        assert pattern.fullmatch(host), f"{host}: el router no lo sirve"


def test_wildcard_covers_new_businesses() -> None:
    """Dar de alta un negocio no pide tocar el repo: el certificado ya cubre
    cualquier subdominio que el router acepte."""
    document = yaml.safe_load(ACTIVE.read_text(encoding="utf-8"))
    mains = [entry["main"] for entry in document["http"]["routers"]["sugerencias-chat"]["tls"]["domains"]]
    assert "*.cliniventas.com" in mains


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
    original_router = yaml.safe_load(ACTIVE.read_text(encoding="utf-8"))["http"]["routers"]["sugerencias-chat"]

    result = _run_bash(sandbox, f"write_active {color}")
    assert result.returncode == 0, result.stderr

    document = yaml.safe_load((sandbox / "active.yml").read_text(encoding="utf-8"))
    router = document["http"]["routers"]["sugerencias-chat"]
    url = document["http"]["services"]["sugerencias-chat"]["loadBalancer"]["servers"][0]["url"]

    assert url == f"http://127.0.0.1:{PORTS[color]}"
    assert router["tls"]["certResolver"] == "letsencrypt"
    assert router == original_router
    _assert_tenant_routing(router["rule"])


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


def test_reverse_proxy_enables_the_file_provider() -> None:
    """Sin el proveedor de archivo, active.yml no enruta nada: traefik sólo ve
    las etiquetas de Docker. Es lo que pasaba en el servidor —el contenedor
    era anterior al blue-green— y por eso ningún despliegue llegaba a
    servirse: conmutar de color no cambiaba absolutamente nada."""
    document = yaml.safe_load(
        (ROOT / "traefik" / "reverse-proxy.docker-compose.yml").read_text(encoding="utf-8")
    )
    traefik = document["services"]["traefik"]

    assert "--providers.file.directory=/dynamic" in traefik["command"]
    assert "--providers.file.watch=true" in traefik["command"]
    assert any(volume.startswith("./dynamic:/dynamic") for volume in traefik["volumes"])
    assert not traefik["image"].endswith(":latest"), "una versión mayor cambiaría el enrutado"


def test_deploy_reconciles_traefik_with_this_configuration() -> None:
    """El despliegue tiene que dejar corriendo ESTE traefik. Si sólo confía en
    el que hubiera en el servidor, vuelve el fallo silencioso: despliegues en
    verde sobre un proxy que enruta a otra cosa."""
    workflow = (ROOT / ".github" / "workflows" / "deploy.yml").read_text(encoding="utf-8")
    assert "reverse-proxy.docker-compose.yml" in workflow
    # El proyecto es el que ya existe: conserva el volumen del certificado.
    assert "-p traefik" in workflow


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
def test_wait_serving_through_traefik_retries_before_giving_up(tmp_path) -> None:
    """Regresión: traefik/dynamic/active.yml declara healthCheck.interval: 10s
    en el loadBalancer. La URL que write_active acaba de escribir es nueva
    para el healthchecker de traefik, que tarda hasta ese intervalo en
    marcarla sana. Un sleep fijo de 2s antes de un único chequeo revertía casi
    todos los despliegues sin necesidad — no era una carrera esporádica, era
    estructural. Acá se simula que las dos primeras consultas fallan (como
    pasaría dentro de esos 10s) y la tercera ya encuentra a traefik sirviendo
    el color nuevo."""
    stub = (
        'attempt=0; curl() { attempt=$((attempt + 1)); '
        'if [ "$attempt" -ge 3 ]; then echo color-nuevo; else return 1; fi; }; '
    )
    result = _run_bash(
        _sandbox(tmp_path),
        f'{stub} TRAEFIK_ATTEMPTS=5 TRAEFIK_INTERVAL=0 wait_serving_through_traefik green',
    )
    assert result.returncode == 0, result.stderr


@requires_bash
def test_wait_serving_through_traefik_gives_up_eventually(tmp_path) -> None:
    result = _run_bash(
        _sandbox(tmp_path),
        'curl() { return 1; }; TRAEFIK_ATTEMPTS=2 TRAEFIK_INTERVAL=0 wait_serving_through_traefik green',
    )
    assert result.returncode != 0, "tiene que rendirse en algún momento, no reintentar para siempre"


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


def _fake_docker(sandbox: Path, *, fail_on: str | None = None) -> str:
    """Un `docker` en el PATH que anota cada llamada y falla si sus
    argumentos contienen ``fail_on``. compose_for() ejecuta docker a través
    de `env`, así que una función de bash no lo reemplazaría."""
    bin_dir = sandbox / "bin"
    bin_dir.mkdir(exist_ok=True)
    fake = bin_dir / "docker"
    fail = f'case "$*" in *"{fail_on}"*) exit 1;; esac\n' if fail_on else ""
    fake.write_text(f'#!/usr/bin/env bash\necho "$*" >> "{sandbox}/calls.txt"\n{fail}exit 0\n', encoding="utf-8")
    fake.chmod(0o755)
    return f'PATH="{bin_dir}:$PATH"; HEALTH_ATTEMPTS=1; HEALTH_INTERVAL=0; '


@requires_bash
def test_failed_migration_never_starts_the_new_color(tmp_path) -> None:
    """Regresión del 2026-11-08: la migración falló después del `up -d`, el
    script cortó por `set -e` y el color nuevo quedó reiniciándose en bucle
    (SchemaNotMigratedError) media hora. Ahora se migra antes de levantarlo y
    lo que haya quedado se baja."""
    sandbox = _sandbox(tmp_path)
    before = (sandbox / "active.yml").read_text(encoding="utf-8")

    result = _run_bash(sandbox, _fake_docker(sandbox, fail_on="scripts.migrate") + "cmd_deploy")

    assert result.returncode == 1
    assert "las migraciones fallaron" in result.stderr
    calls = (sandbox / "calls.txt").read_text(encoding="utf-8").splitlines()
    verbs = [call.split("compose.bluegreen.yml ", 1)[-1] for call in calls]
    assert verbs[0] == "build"
    assert verbs[1].startswith("run --rm --no-deps backend python -m scripts.migrate")
    assert verbs[2] == "down --remove-orphans"
    assert not any(verb.startswith("up") for verb in verbs)
    assert (sandbox / "active.yml").read_text(encoding="utf-8") == before


@requires_bash
def test_new_color_that_never_gets_healthy_is_taken_down(tmp_path) -> None:
    sandbox = _sandbox(tmp_path)
    before = (sandbox / "active.yml").read_text(encoding="utf-8")

    # El docker falso responde a todo, pero nada escucha en el puerto del
    # color: curl falla y el color nunca queda sano.
    result = _run_bash(sandbox, _fake_docker(sandbox) + "cmd_deploy")

    assert result.returncode == 1
    assert "no llegó a estar sano" in result.stderr
    verbs = [call.split("compose.bluegreen.yml ", 1)[-1]
             for call in (sandbox / "calls.txt").read_text(encoding="utf-8").splitlines()]
    assert verbs.index("up -d --force-recreate") > verbs.index("build")
    assert verbs[-1] == "down --remove-orphans"
    assert (sandbox / "active.yml").read_text(encoding="utf-8") == before



def test_nginx_resolves_the_backend_on_every_request() -> None:
    """Regresión del 2026-11-08: con `proxy_pass http://backend:8000`
    literal, nginx resolvía `backend` una sola vez al arrancar. El frontend de
    green quedó de un deploy fallido, el siguiente recreó backend y worker,
    se intercambiaron las IPs y toda la API respondió 502."""
    conf = "\n".join(
        line.split("#", 1)[0]
        for line in (ROOT / "frontend" / "nginx.conf").read_text(encoding="utf-8").splitlines()
    )
    assert "proxy_pass http://backend" not in conf
    assert "resolver 127.0.0.11" in conf
    assert "location = /api/health/ready" in conf


@requires_bash
def test_deploy_requires_the_api_to_answer_through_the_frontend(tmp_path) -> None:
    """El frontend sirviendo index.html no alcanza: el 2026-11-08 `/`
    respondía 200 y toda `/api` 502. healthy() tiene que pasar por nginx
    hasta el backend antes de conmutar."""
    sandbox = _sandbox(tmp_path)
    before = (sandbox / "active.yml").read_text(encoding="utf-8")
    curl_fake = (
        'curl() { echo "curl ${@: -1}" >> calls.txt; '
        'case "${@: -1}" in */api/health/ready) return 22;; *) return 0;; esac; }; '
    )

    result = _run_bash(sandbox, _fake_docker(sandbox) + curl_fake + "cmd_deploy")

    assert result.returncode == 1
    calls = (sandbox / "calls.txt").read_text(encoding="utf-8")
    assert "curl http://127.0.0.1:8081/api/health/ready" in calls or "curl http://127.0.0.1:8082/api/health/ready" in calls
    assert "no llegó a estar sano" in result.stderr
    assert (sandbox / "active.yml").read_text(encoding="utf-8") == before
