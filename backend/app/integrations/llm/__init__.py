"""Clientes de modelos de lenguaje (Gemini, OpenAI) con salida JSON validable.

Cada negocio carga sus propias claves en Integraciones y elige un modelo
principal y uno secundario; el copiloto nativo (``app.modules.ai``) los usa a
través de ``build_client``. Acá solo vive el protocolo HTTP de cada proveedor.
"""
