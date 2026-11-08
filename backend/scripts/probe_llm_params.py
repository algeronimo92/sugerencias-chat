"""Comprueba contra las APIs reales que el registro de modelos dice la verdad.

Para cada modelo de ``app.integrations.llm.catalog`` y cada parámetro que el
registro dice que acepta, manda una generación mínima con ese parámetro en un
valor no default (respetando sus dependencias, p. ej. temperature con
reasoning="none") y anota si la API la acepta. Correrlo al agregar un modelo y
de vez en cuando: los proveedores cambian qué aceptan sin avisar (el
2026-11-08 la documentación de OpenAI decía que gpt-5.x aceptaba ``stop`` y la
API lo rechazaba).

Las claves se leen de ``OPENAI_API_KEY`` y ``GEMINI_API_KEY``; un proveedor
sin clave se salta. Gasta unas pocas llamadas mínimas por modelo.

Uso:
    OPENAI_API_KEY=... GEMINI_API_KEY=... python -m scripts.probe_llm_params
    python -m scripts.probe_llm_params --model openai:gpt-5.5
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys

from app.integrations.llm.base import LlmError
from app.integrations.llm.catalog import SPECS, ParamSpec
from app.integrations.llm.client import build_client

KEY_ENV = {"openai": "OPENAI_API_KEY", "gemini": "GEMINI_API_KEY"}


def sample_value(param: ParamSpec):
    """Un valor válido y distinto del default, para que de verdad se mande."""
    if param.kind == "choice":
        others = [choice for choice in param.choices if choice != param.default]
        return others[0] if others else param.default
    if param.kind == "text_list":
        return ["###FIN###"]
    low = param.min if param.min is not None else 0
    high = param.max if param.max is not None else low + 1
    value = low + (high - low) / 4
    if param.kind == "int":
        value = int(value)
    if param.default is not None and value == param.default:
        value = high
    return value


def probe_cases(spec_name: str) -> list[tuple[str, dict]]:
    spec = SPECS[spec_name]
    cases = []
    for name, param in spec.params.items():
        if name in ("timeout_seconds", "max_output_tokens"):
            continue  # no los decide la API
        overrides = {name: sample_value(param)}
        for other, allowed in param.requires.items():
            overrides[other] = allowed[0]
        if param.kind == "choice":
            for choice in param.choices:
                cases.append((f"{name}={choice}", {**overrides, name: choice}))
        else:
            cases.append((f"{name}={overrides[name]}", overrides))
    return cases


async def run(models: list[str]) -> int:
    failures = 0
    for spec_name in models:
        provider = SPECS[spec_name].provider
        key = os.environ.get(KEY_ENV[provider], "").strip()
        if not key:
            print(f"-- {spec_name}: sin {KEY_ENV[provider]}, se salta")
            continue
        print(f"== {spec_name}")
        for label, overrides in probe_cases(spec_name):
            client = build_client(spec_name, key, overrides)
            try:
                await client.ping()
                print(f"   ok    {label}")
            except LlmError as exc:
                if "longitud" in str(exc):
                    # La API aceptó el parámetro; la prueba mínima (300 tokens)
                    # se quedó corta, típicamente con razonamiento alto.
                    print(f"   ok    {label} (aceptado; la prueba mínima se cortó por longitud)")
                    continue
                failures += 1
                print(f"   FALLA {label}: {str(exc)[:160]}")
            await asyncio.sleep(1)  # cuotas gratuitas: no disparar en ráfaga
    print(f"\n{failures} parámetro(s) del registro que la API rechazó")
    return 1 if failures else 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--model", action="append", help="proveedor:modelo (repetible); por defecto, todos")
    args = parser.parse_args()
    models = args.model or list(SPECS)
    unknown = [model for model in models if model not in SPECS]
    if unknown:
        print(f"Modelos fuera del registro: {', '.join(unknown)}", file=sys.stderr)
        return 2
    return asyncio.run(run(models))


if __name__ == "__main__":
    raise SystemExit(main())
