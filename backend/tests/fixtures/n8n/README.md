# Workflows n8n sanitizados

Estos exports son las copias versionables que validan los tests de contrato. Estan
inactivos, no incluyen `pinData`, secretos ni IDs de credenciales. Los JSON de la
raiz son copias locales equivalentes para importacion manual y permanecen
ignorados por Git.

`config.json` es un sub-workflow que usa `analista`: expone `backend_url` para
no depender de `$env.BACKEND_URL` (el plan hosted de n8n del proyecto no
permite crear variables de entorno).

El workflow de sugerencias (`rag`) se retiró en noviembre de 2026: las
sugerencias las genera el CRM con las claves de IA de cada negocio
(`app/modules/ai/infrastructure/native_provider.py`) y los webhooks que usaba
(`/api/webhooks/rag-context` y `/rag-search`) ya no existen. En n8n se puede
desactivar.

## Webhook de Meta

Meta llama directo al backend (`/api/webhooks/meta/whatsapp`, ver el README
raíz); n8n ya no recibe ni reenvía mensajes. El relay `meta-cloud-api` se
retiró en noviembre de 2026: si sigue importado en n8n, se puede borrar.

## Antes de activar un workflow importado

1. Importar `config.json` primero y anotar el ID que le asigna n8n.
2. En `analista`, abrir el nodo **Execute Workflow** llamado "Config" y
   apuntarlo al workflow `config.json` importado en el paso 1.
3. Vincular la credencial **Header Auth** del Webhook expuesto por `analista`.
4. Vincular la credencial **HTTP Header Auth** del backend a los nodos HTTP y
   HTTP Tool de `analista`. Debe aportar `X-Webhook-Token`; el workflow
   agrega los headers de job que corresponden a cada item.
5. Vincular las credenciales de los modelos de lenguaje usados por `analista`.
6. La URL del Webhook de `analista`, el token con el que el backend lo llama y las credenciales de la app de Meta (verify token y app
   secret) se cargan una sola vez en el panel de plataforma. Lo que cada negocio
   sabe de si mismo (perfil, precios, conocimiento, adjuntos) llega en el
   contexto del job, no en el workflow.

Los workflows se deben importar y probar inactivos. Solo se activan despues de
asociar las credenciales, apuntar los nodos Config y ejecutar las pruebas de
contrato contra el backend del entorno.
