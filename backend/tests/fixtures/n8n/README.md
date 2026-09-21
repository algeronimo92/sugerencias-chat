# Workflows n8n sanitizados

Estos exports son las copias versionables que validan los tests de contrato. Estan
inactivos, no incluyen `pinData`, secretos ni IDs de credenciales. Los JSON de la
raiz son copias locales equivalentes para importacion manual y permanecen
ignorados por Git.

`config.json` es un sub-workflow compartido por los otros tres: expone
`backend_url` para que `rag`, `analista` y `meta-cloud-api` dejen de depender de
`$env.BACKEND_URL` (el plan hosted de n8n del proyecto no permite crear
variables de entorno). El verify token y el app secret de Meta ya no viven en
n8n: el Code node reenvia el challenge/la firma al backend
(`/api/webhooks/meta/verify-challenge` y `/api/webhooks/meta/verify-signature`),
que los compara contra `meta_verify_token`/`meta_app_secret` en
`app_settings` (ver `services/meta_webhook_auth.py`).

Antes de activar un workflow importado:

1. Importar `config.json` primero y anotar el ID que le asigna n8n.
2. En `rag`, `analista` y `meta-cloud-api`, abrir cada nodo **Execute Workflow**
   llamado "Config" (o "Config (GET)"/"Config (POST)"/"Config (retry)" en
   `meta-cloud-api`) y apuntarlo al workflow `config.json` importado en el paso 1
   (su `workflowId` llega con un placeholder `REEMPLAZAR_CON_ID_DE_CONFIG`).
3. Vincular la credencial **Header Auth** de los Webhook expuestos por `rag` y
   `analista`.
4. Vincular la credencial **HTTP Header Auth** del backend a todos los nodos HTTP,
   HTTP Tool y a los dos nodos que verifican el challenge/la firma de Meta. Debe
   aportar `X-Webhook-Token`; el workflow agrega los headers tenant, job y
   conexion que corresponden a cada item.
5. Vincular las credenciales de los modelos de lenguaje usados por `rag` y
   `analista`.
6. Configurar en la app (Configuracion > Meta Cloud API) `meta_verify_token` y
   `meta_app_secret`; ya no se configuran como variable de entorno de n8n.
7. Confirmar que el Webhook POST de Meta conserva **Raw Body**. La firma
   `X-Hub-Signature-256` se calcula sobre esos bytes antes de normalizar o
   confirmar el evento.

Los workflows se deben importar y probar inactivos. Solo se activan despues de
asociar las credenciales, apuntar los nodos Config y ejecutar las pruebas de
contrato contra el backend del entorno.
