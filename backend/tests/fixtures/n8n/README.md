# Workflows n8n sanitizados

Estos exports son las copias versionables que validan los tests de contrato. Estan
inactivos, no incluyen `pinData`, secretos ni IDs de credenciales. Los JSON de la
raiz son copias locales equivalentes para importacion manual y permanecen
ignorados por Git.

`config.json` es un sub-workflow compartido por los otros tres: expone
`backend_url` para que `rag`, `analista` y `meta-cloud-api` dejen de depender de
`$env.BACKEND_URL` (el plan hosted de n8n del proyecto no permite crear
variables de entorno).

## Webhook de Meta

Lo recomendado es registrar en Meta la URL del backend directamente:
`https://<dominio del backend>/api/webhooks/meta/whatsapp`, con el verify token
configurado en el panel de plataforma. El backend verifica el challenge y la
firma `X-Hub-Signature-256`, guarda cada evento sin tocarlo y lo procesa (ver
`routers/meta_webhook.py` y `services/meta_webhook/`).

`meta-cloud-api.json` queda solo para instalaciones que necesiten a n8n delante
de Meta. Es un relay: reenvia al endpoint del backend el challenge del GET y el
cuerpo crudo del POST junto con la firma, sin normalizarlos, y responde a Meta
lo que respondio el backend. Si el backend no guardo el evento, Meta recibe un
error y reintenta la entrega. El Webhook POST debe conservar **Raw Body**: la
firma se calcula sobre esos bytes y cualquier cambio la invalida.

## Antes de activar un workflow importado

1. Importar `config.json` primero y anotar el ID que le asigna n8n.
2. En `rag`, `analista` y `meta-cloud-api`, abrir cada nodo **Execute Workflow**
   llamado "Config" (o "Config (GET)"/"Config (POST)" en `meta-cloud-api`) y
   apuntarlo al workflow `config.json` importado en el paso 1.
3. Vincular la credencial **Header Auth** de los Webhook expuestos por `rag` y
   `analista`.
4. Vincular la credencial **HTTP Header Auth** del backend a los nodos HTTP y
   HTTP Tool de `rag` y `analista`. Debe aportar `X-Webhook-Token`; el workflow
   agrega los headers de job que corresponden a cada item. Los nodos del relay
   de Meta no la necesitan: el endpoint se autentica con la firma de Meta.
5. Vincular las credenciales de los modelos de lenguaje usados por `rag` y
   `analista`.
6. La URL del Webhook de `rag` y la de `analista`, el token con el que el
   backend los llama y las credenciales de la app de Meta (verify token y app
   secret) se cargan una sola vez en el panel de plataforma. Lo que cada negocio
   sabe de si mismo (perfil, precios, conocimiento, adjuntos) llega en el
   contexto del job, no en el workflow.

Los workflows se deben importar y probar inactivos. Solo se activan despues de
asociar las credenciales, apuntar los nodos Config y ejecutar las pruebas de
contrato contra el backend del entorno.
