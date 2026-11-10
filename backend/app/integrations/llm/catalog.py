"""Qué modelos puede elegir un negocio y qué parámetros acepta cada uno.

Registro de capacidades: cada modelo declara sus parámetros (tipo, rango o
valores, default para el copiloto y reglas entre ellos). El negocio sobrescribe
lo que quiera para su modelo principal y su secundario; lo que no sobrescribe
toma el default de acá. Los nombres son neutrales (``reasoning``,
``max_output_tokens``…): cada cliente los traduce al dialecto de su API.

La fuente es lo probado contra las APIs, no la documentación: el 2026-11-08
Google listaba ``gemini-2.5-flash`` y respondía 404, y OpenAI documentaba
``stop`` para la familia GPT-5 y lo rechaza. ``scripts.probe_llm_params``
repite esas pruebas y avisa si el registro dejó de coincidir con la API.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True)
class ParamSpec:
    """Un parámetro de generación de un modelo."""

    kind: str  # "choice" | "float" | "int" | "text_list"
    label: str
    help: str = ""
    choices: tuple[str, ...] = ()
    min: float | None = None
    max: float | None = None
    # None: no se manda y decide el proveedor.
    default: Any = None
    # Solo vale si otro parámetro tiene uno de estos valores
    # (p. ej. temperature en gpt-5.x solo con reasoning="none").
    requires: dict[str, tuple[str, ...]] = field(default_factory=dict)


@dataclass(frozen=True)
class ModelSpec:
    provider: str
    model: str
    label: str
    context_window: int
    max_output_tokens: int
    params: dict[str, ParamSpec]
    note: str = ""


# Comunes a todos los modelos.
def _max_output(limit: int, default: int = 8000) -> ParamSpec:
    return ParamSpec(
        "int", "Máximo de tokens de salida", min=256, max=limit, default=default,
        help="Incluye los tokens de razonamiento: si es muy bajo, el modelo puede gastarlo pensando y devolver vacío.",
    )


TIMEOUT = ParamSpec("int", "Tiempo máximo por intento (segundos)", min=10, max=120, default=60,
                    help="Si el modelo no responde a tiempo, se pasa al secundario.")
SEED = ParamSpec("int", "Semilla", min=0, max=2_147_483_647,
                 help="Misma semilla y mismo pedido tienden a dar la misma respuesta (no está garantizado).")
VERBOSITY = ParamSpec("choice", "Extensión de la respuesta", choices=("low", "medium", "high"), default="medium")


def _gpt5_reasoning(choices: tuple[str, ...]) -> ParamSpec:
    return ParamSpec("choice", "Razonamiento", choices=choices, default="low",
                     help="Más razonamiento = mejores decisiones, más lento y más caro.")


# Muestreo de los gpt-5.x: la API los rechaza salvo con reasoning="none".
_NO_REASONING = {"reasoning": ("none",)}
GPT5_SAMPLING = {
    "temperature": ParamSpec("float", "Temperatura", min=0, max=2, requires=_NO_REASONING,
                             help="Solo con razonamiento 'none'. Más alta = más variedad entre sugerencias."),
    "top_p": ParamSpec("float", "Top P", min=0, max=1, requires=_NO_REASONING),
    "presence_penalty": ParamSpec("float", "Penalización por presencia", min=-2, max=2, requires=_NO_REASONING),
    "frequency_penalty": ParamSpec("float", "Penalización por frecuencia", min=-2, max=2, requires=_NO_REASONING),
}

_GEMINI_THINKING_HELP = "Gemini 3 no permite apagar el razonamiento; 'minimal' es lo más bajo."

MODELS: tuple[ModelSpec, ...] = (
    ModelSpec("gemini", "gemini-3.6-flash", "Gemini 3.6 Flash", 1_048_576, 65_536, {
        "reasoning": ParamSpec("choice", "Razonamiento", choices=("minimal", "low", "medium", "high"), default="low",
                               help=_GEMINI_THINKING_HELP),
        "max_output_tokens": _max_output(65_536),
        "stop": ParamSpec("text_list", "Secuencias de corte", max=5),
        "timeout_seconds": TIMEOUT,
    }, note="Temperatura y Top P: Google los deprecó en 3.6 y los ignora."),
    ModelSpec("gemini", "gemini-3.5-flash-lite", "Gemini 3.5 Flash-Lite", 1_048_576, 65_536, {
        # Probado: "none" responde 400 en este modelo.
        "reasoning": ParamSpec("choice", "Razonamiento", choices=("minimal", "low", "medium", "high"), default="minimal",
                               help=_GEMINI_THINKING_HELP),
        "max_output_tokens": _max_output(65_536),
        "stop": ParamSpec("text_list", "Secuencias de corte", max=5),
        "timeout_seconds": TIMEOUT,
    }, note="Temperatura y Top P: deprecados, se ignoran."),
    ModelSpec("gemini", "gemini-3.1-flash-lite", "Gemini 3.1 Flash-Lite", 1_048_576, 65_536, {
        "reasoning": ParamSpec("choice", "Razonamiento", choices=("minimal", "low", "medium", "high"), default="minimal",
                               help=_GEMINI_THINKING_HELP),
        "temperature": ParamSpec("float", "Temperatura", min=0, max=2,
                                 help="Google recomienda dejarla en 1.0: bajarla puede generar bucles."),
        "top_p": ParamSpec("float", "Top P", min=0, max=1),
        "max_output_tokens": _max_output(65_536),
        "stop": ParamSpec("text_list", "Secuencias de corte", max=5),
        "timeout_seconds": TIMEOUT,
    }),
    ModelSpec("openai", "gpt-5.6-terra", "GPT-5.6 Terra", 1_050_000, 128_000, {
        # La doc de OpenAI lista "max" para 5.6; la API lo rechaza (probado).
        "reasoning": _gpt5_reasoning(("none", "low", "medium", "high", "xhigh")),
        "verbosity": VERBOSITY,
        **GPT5_SAMPLING,
        "seed": SEED,
        "max_output_tokens": _max_output(128_000),
        "timeout_seconds": TIMEOUT,
    }),
    ModelSpec("openai", "gpt-5.5", "GPT-5.5", 1_050_000, 128_000, {
        "reasoning": _gpt5_reasoning(("none", "low", "medium", "high", "xhigh")),
        "verbosity": VERBOSITY,
        **GPT5_SAMPLING,
        "seed": SEED,
        "max_output_tokens": _max_output(128_000),
        "timeout_seconds": TIMEOUT,
    }),
    ModelSpec("openai", "gpt-5-mini", "GPT-5 mini", 400_000, 128_000, {
        # Sin "none" ni "xhigh" (400), y sin muestreo a ningún nivel.
        "reasoning": _gpt5_reasoning(("minimal", "low", "medium", "high")),
        "verbosity": VERBOSITY,
        "seed": SEED,
        "max_output_tokens": _max_output(128_000),
        "timeout_seconds": TIMEOUT,
    }),
    ModelSpec("openai", "gpt-4.1-mini", "GPT-4.1 mini", 1_047_576, 32_768, {
        # Sin razonamiento: reasoning_effort responde 400 "Unrecognized".
        "temperature": ParamSpec("float", "Temperatura", min=0, max=2),
        "top_p": ParamSpec("float", "Top P", min=0, max=1),
        "presence_penalty": ParamSpec("float", "Penalización por presencia", min=-2, max=2),
        "frequency_penalty": ParamSpec("float", "Penalización por frecuencia", min=-2, max=2),
        "stop": ParamSpec("text_list", "Secuencias de corte", max=4),
        "seed": SEED,
        "max_output_tokens": _max_output(32_768),
        "timeout_seconds": TIMEOUT,
    }),
)

PROVIDER_META: dict[str, dict] = {
    "gemini": {"label": "Google Gemini", "key_setting": "ai_gemini_api_key"},
    "openai": {"label": "OpenAI", "key_setting": "ai_openai_api_key"},
}
SPECS: dict[str, ModelSpec] = {f"{m.provider}:{m.model}": m for m in MODELS}
# Forma que ya consumían la API y la tarjeta de Integraciones.
PROVIDERS: dict[str, dict] = {
    name: {**meta, "models": [m.model for m in MODELS if m.provider == name]}
    for name, meta in PROVIDER_META.items()
}

# Modelos que el proveedor retiró → su reemplazo. Un negocio que los tenía
# guardados sigue funcionando con el reemplazo sin tener que entrar a
# Integraciones; guardar uno retirado ya no se puede.
RETIRED_MODELS: dict[str, str] = {
    "gemini:gemini-2.0-flash": "gemini:gemini-3.6-flash",
    "gemini:gemini-2.5-flash": "gemini:gemini-3.6-flash",
    "gemini:gemini-2.5-flash-lite": "gemini:gemini-3.5-flash-lite",
    "gemini:gemini-2.5-pro": "gemini:gemini-3.6-flash",
    "gemini:gemini-3.5-flash": "gemini:gemini-3.6-flash",
}

# El modelo recomendado de cada proveedor, el que entra cuando el negocio no
# eligió uno.
PROVIDER_DEFAULT_MODEL: dict[str, str] = {
    "gemini": "gemini:gemini-3.6-flash",
    "openai": "openai:gpt-5.6-terra",
}
# Sin claves (o con las dos y sin elección), Gemini procesa y OpenAI respalda,
# como en el agente de n8n.
DEFAULT_PRIMARY = PROVIDER_DEFAULT_MODEL["gemini"]
DEFAULT_FALLBACK = PROVIDER_DEFAULT_MODEL["openai"]


def default_models(values: dict) -> tuple[str, str]:
    """Principal y respaldo cuando el negocio no eligió: procesa el proveedor
    del que tiene clave. Con una sola clave de OpenAI, la tarjeta mostraba a
    Gemini "(sin clave)" como principal mientras respondía OpenAI por detrás.
    ``values`` trae las claves de los proveedores (cualquier valor no vacío
    cuenta como cargada)."""
    configured = [
        provider for provider, meta in PROVIDER_META.items()
        if str(values.get(meta["key_setting"]) or "").strip()
    ]
    if len(configured) == 1:
        first = configured[0]
        second = next(provider for provider in PROVIDER_META if provider != first)
        return PROVIDER_DEFAULT_MODEL[first], PROVIDER_DEFAULT_MODEL[second]
    return DEFAULT_PRIMARY, DEFAULT_FALLBACK


def parse_model_spec(spec: str) -> tuple[str, str]:
    """``proveedor:modelo`` validado contra el catálogo vigente."""
    provider, _, model = (spec or "").strip().partition(":")
    if provider not in PROVIDERS:
        raise ValueError(f"Proveedor de IA desconocido: {provider or '(vacío)'}")
    if model not in PROVIDERS[provider]["models"]:
        raise ValueError(f"Modelo no disponible para {PROVIDERS[provider]['label']}: {model or '(vacío)'}")
    return provider, model


def resolve_model_spec(spec: str) -> str:
    """Lo guardado por un negocio, llevado al catálogo vigente: un modelo
    retirado se lee como su reemplazo. Para leer configuración; para guardar
    se valida con ``parse_model_spec``."""
    normalized = (spec or "").strip()
    normalized = RETIRED_MODELS.get(normalized, normalized)
    provider, model = parse_model_spec(normalized)
    return f"{provider}:{model}"


def key_setting_for(provider: str) -> str:
    return PROVIDER_META[provider]["key_setting"]


# --- Parámetros -----------------------------------------------------------

def parse_overrides(raw: str | dict | None) -> dict:
    """Lo guardado (JSON) como dict; vacío o ilegible = sin sobrescrituras."""
    if isinstance(raw, dict):
        return dict(raw)
    try:
        value = json.loads(raw) if raw and str(raw).strip() else {}
    except ValueError:
        return {}
    return value if isinstance(value, dict) else {}


def _check(name: str, spec: ParamSpec, value: Any) -> Any:
    if spec.kind == "choice":
        if value not in spec.choices:
            raise ValueError(f"{spec.label}: '{value}' no es válido (opciones: {', '.join(spec.choices)})")
        return value
    if spec.kind in ("float", "int"):
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise ValueError(f"{spec.label}: debe ser un número")
        if spec.kind == "int" and float(value) != int(value):
            raise ValueError(f"{spec.label}: debe ser un número entero")
        number = int(value) if spec.kind == "int" else float(value)
        if (spec.min is not None and number < spec.min) or (spec.max is not None and number > spec.max):
            raise ValueError(f"{spec.label}: debe estar entre {spec.min:g} y {spec.max:g}")
        return number
    if spec.kind == "text_list":
        if not isinstance(value, list) or not all(isinstance(item, str) and item for item in value):
            raise ValueError(f"{spec.label}: debe ser una lista de textos")
        if spec.max is not None and len(value) > spec.max:
            raise ValueError(f"{spec.label}: como máximo {spec.max:g}")
        return value
    raise ValueError(f"{name}: tipo de parámetro desconocido")


def validate_overrides(model_spec: str, overrides: dict) -> dict:
    """Lo que el negocio quiere sobrescribir, validado contra el modelo. Un
    valor ``None`` quita la sobrescritura (vuelve al default). Falla con un
    mensaje para el admin si algo no aplica a ese modelo."""
    spec = SPECS[resolve_model_spec(model_spec)]
    clean: dict = {}
    for name, value in overrides.items():
        if value is None:
            continue
        if name not in spec.params:
            raise ValueError(f"{spec.label} no acepta el parámetro '{name}'")
        clean[name] = _check(name, spec.params[name], value)
    effective = {**_defaults(spec), **clean}
    for name in clean:
        for other, allowed in spec.params[name].requires.items():
            if effective.get(other) not in allowed:
                label = spec.params[other].label
                raise ValueError(
                    f"{spec.params[name].label}: en {spec.label} solo se puede usar con {label.lower()} "
                    f"'{' / '.join(allowed)}'"
                )
    return clean


def sanitize_overrides(model_spec: str, overrides: dict) -> tuple[dict, list[str]]:
    """Como ``validate_overrides`` pero sin fallar: descarta lo que no aplica
    (p. ej. tras cambiar de modelo o por un retiro) y dice qué descartó."""
    kept: dict = {}
    dropped: list[str] = []
    for name, value in overrides.items():
        try:
            kept.update(validate_overrides(model_spec, {**kept, name: value}))
        except ValueError:
            dropped.append(name)
    return kept, dropped


def _defaults(spec: ModelSpec) -> dict:
    return {name: param.default for name, param in spec.params.items() if param.default is not None}


def effective_params(model_spec: str, overrides: dict | None = None) -> dict:
    """Defaults del modelo + lo que el negocio sobrescribió, sin lo que no
    aplica (incluidos los que dependen de otro parámetro que no se cumple)."""
    spec = SPECS[resolve_model_spec(model_spec)]
    kept, _dropped = sanitize_overrides(model_spec, overrides or {})
    params = {**_defaults(spec), **kept}
    return {
        name: value for name, value in params.items()
        if all(params.get(other) in allowed for other, allowed in spec.params[name].requires.items())
    }


def params_schema(model_spec: str) -> dict:
    """Lo que la tarjeta de Integraciones necesita para dibujar el formulario."""
    spec = SPECS[resolve_model_spec(model_spec)]
    return {
        "label": spec.label,
        "note": spec.note,
        "context_window": spec.context_window,
        "max_output_tokens": spec.max_output_tokens,
        "params": [
            {
                "name": name, "kind": param.kind, "label": param.label, "help": param.help,
                "choices": list(param.choices), "min": param.min, "max": param.max,
                "default": param.default, "requires": {k: list(v) for k, v in param.requires.items()},
            }
            for name, param in spec.params.items()
        ],
    }
