# Plan: "Conectar con Google" para Google Calendar

> **Estado (2026-10-21):** implementado. Cambios respecto del plan original:
> - El `state` también lleva el origen del CRM desde el que se inició el flujo (validado contra los dominios del negocio, o contra `CORS_ORIGINS` en single-tenant). El callback vuelve a ese origen, lo que también funciona en desarrollo con Vite en otro puerto.
> - La clave que firma el `state` se deriva de `SECRET_KEY` con separación de dominio. No hace falta un secreto nuevo.
> - `GET /status` no trae `needs_reconnect`: la reconexión se detecta cuando `GET /calendars` responde 409 con `code=google_reconnect`.
> - Las rutas y el callback viven juntos en `app/modules/platform/google_calendar_api.py`.
> - Al conectar se borran el Client ID y el Secret propios que hayan quedado de la carga manual: si no, ganarían sobre el token nuevo de la plataforma.

## Contexto

Hoy cada negocio pega a mano en Configuración → Claves el Calendar ID, el OAuth
Client ID, el Client Secret y un Refresh Token que tiene que generar por su cuenta
en Google Cloud. Es molesto y no escala para el SaaS multi-tenant.

El objetivo es repetir el patrón del Embedded Signup de Meta:
- Un **único cliente OAuth de la plataforma**, que el operador administra en el panel de plataforma.
- En el CRM, el admin del negocio hace clic en **"Conectar con Google"**, acepta los permisos, elige el calendario de una lista y queda listo.
- **"Desconectar"** revoca el acceso en Google.

La creación de eventos ([google_calendar.py](backend/app/integrations/google_calendar.py)) y el flujo de citas ([commands.py](backend/app/modules/appointments/application/commands.py)) casi no cambian.

## Decisión clave: flujo con redirección y un callback único

Google no acepta comodines en las URIs de redirección ni en los orígenes de JS, y cada negocio vive en su propio dominio (`organization_domains`). Por eso **no** se usa el popup de Google Identity Services: obligaría a registrar el origen de cada negocio en Google Cloud.

En su lugar:
- Se registra **una sola** redirect URI en Google Cloud, por ejemplo `https://<host fijo>/api/integrations/google/callback`.
- Ese path queda exento del `TenantResolutionMiddleware`. El negocio se resuelve desde un `state` firmado, igual que los callbacks de n8n se resuelven por token y no por host.
- Al terminar, el callback redirige al dominio primario del negocio: `resolve_tenant_by_organization_id` ya devuelve el `hostname` primario ([resolver.py:167](backend/app/tenancy/resolver.py#L167)).

## Backend

### 1. Credenciales de plataforma
- [platform_settings.py](backend/app/modules/platform/platform_settings.py): agregar a `PLATFORM_SETTING_DEFS`:
  - `google_oauth_client_id` (no secreto)
  - `google_oauth_client_secret` (secreto)
  - `google_oauth_redirect_uri` (no secreto)

  El panel de plataforma ya lista estas definiciones de forma genérica, así que no hace falta tocar su interfaz.
- [config.py](backend/app/core/config.py): los mismos tres campos como respaldo desde el entorno, igual que `meta_app_id` y `meta_app_secret`.

### 2. Ajustes del negocio ([settings_service.py:150-162](backend/app/modules/platform/settings_service.py#L150-L162))
- `google_calendar_refresh_token`, `google_calendar_client_id` y `google_calendar_client_secret` pasan a `hidden=True`. Dejan de aparecer en "Claves", pero se siguen leyendo para no romper a los negocios que ya los cargaron a mano.
- Nuevo `google_calendar_account_email` (no secreto, `hidden=True`): la cuenta conectada, para mostrarla en la interfaz.
- Nuevo `google_calendar_oauth_nonce` (`hidden=True`): el nonce de un solo uso del flujo en curso.
- `google_calendar_enabled`, `google_calendar_id` y `business_timezone` se quedan como están; el panel nuevo los maneja.

### 3. Cliente de Google ([google_calendar.py](backend/app/integrations/google_calendar.py))
- `_oauth_client()`: usa el client id y el secret del negocio si los tiene (configuración manual heredada) y, si no, los de plataforma con `platform_settings_many`.
- Extraer `_access_token(client, config)` del cuerpo actual de `create_google_event` para reutilizarlo.
- Funciones nuevas:
  - `authorization_url(state, code_challenge)`. Parámetros:
    - `access_type=offline` y `prompt=consent`, para que Google siempre devuelva el refresh token.
    - `include_granted_scopes=true`.
    - Scopes `calendar.events` y `calendar.calendarlist.readonly`. Confirmar en la documentación actual de Google que el segundo existe.
    - PKCE S256.
  - `exchange_code(code, code_verifier)`: llama a `POST oauth2.googleapis.com/token` con `grant_type=authorization_code`.
  - `list_calendars(refresh_token)`: llama a `GET /users/me/calendarList?minAccessRole=writer`. El calendario con `primary=true` da el email de la cuenta.
  - `revoke(refresh_token)`: llama a `POST oauth2.googleapis.com/revoke`. Si falla, no se bloquea la desconexión.
- Si el refresh devuelve `invalid_grant`, se reemplaza el error genérico por "La conexión con Google expiró o fue revocada; reconecta en Configuración → Google Calendar".

### 4. Firma del `state`
- Nuevo módulo `app/modules/platform/google_oauth_state.py`, con el mismo patrón HMAC de [ai_job_tokens.py](backend/app/modules/ai/ai_job_tokens.py) pero con su propia clave (un propósito distinto derivado de `ai_job_signing_secret`, o un secreto nuevo).
- Contenido del token: `organization_id`, `user_id`, `nonce` y `exp` (10 minutos).
- El `code_verifier` de PKCE se deriva de forma determinista del nonce con HMAC. Así no hace falta guardarlo aparte.

### 5. Rutas
**`app/modules/platform/google_calendar_api.py`**, montada con `require_admin` igual que `settings_router` en [bootstrap.py:151](backend/app/bootstrap.py#L151), con prefijo `/api/settings/google-calendar`:

| Ruta | Qué hace |
|---|---|
| `GET /status` | Devuelve `{oauth_available, connected, account_email, calendar_id, enabled, needs_reconnect}`. `oauth_available` indica si la plataforma tiene su cliente OAuth configurado. |
| `POST /authorize` | Genera el nonce, lo guarda en `google_calendar_oauth_nonce`, firma el `state` y devuelve `{url}`. Responde 409 si la plataforma no tiene el cliente OAuth. |
| `GET /calendars` | Lista los calendarios donde la cuenta puede escribir. |
| `PUT /calendar` | Guarda el `calendar_id` elegido y pone `enabled=true`. Valida que el calendario esté en la lista. |
| `POST /disconnect` | Revoca el token y limpia el refresh token, el email, el calendar id y el enabled. Las citas ya sincronizadas no se tocan. |

**`app/modules/platform/google_oauth_callback.py`**, router público `GET /api/integrations/google/callback`:
1. Verifica la firma y la expiración del `state`.
2. Llama a `resolve_tenant_by_organization_id` y entra en `tenant_context(...)` para escribir en el schema correcto.
3. Compara el nonce con el guardado y lo borra (un solo uso).
4. Hace `exchange_code`. Si Google no devolvió `refresh_token`, es un error.
5. Llama a `list_calendars` para obtener el email.
6. Guarda con `update_settings` el `refresh_token`, el `account_email` y `google_calendar_id = "primary"`, con `enabled=true` para que funcione de inmediato.
7. Redirige con 302 a `https://{hostname primario}/?settings=calendar&google=connected`. Si algo falla, redirige con `google=error&reason=<código corto>`, nunca con el detalle de Google.

- Se agrega `/api/integrations/google/callback` a `DEFAULT_EXEMPT_PATHS` en [middleware.py](backend/app/tenancy/middleware.py#L15).
- En instalaciones single-tenant (`multitenancy_enabled=False`) no hay organización. El `state` lleva `organization_id=None`, el callback escribe en `public` y redirige a una URL relativa (`/?settings=calendar...`).

## Frontend

- **`frontend/src/features/platform/components/GoogleCalendarPanel.tsx`**, con un estilo parecido a [WhatsappPanel.tsx](frontend/src/features/platform/components/WhatsappPanel.tsx):
  - **Sin conectar:** explicación breve y botón "Conectar con Google", que llama a `POST /authorize` y hace `window.location.assign(url)`. Si `oauth_available` es falso, muestra un aviso de que la plataforma todavía no habilitó la integración.
  - **Conectado:** la cuenta conectada, un selector de calendario (`GET /calendars` + `PUT /calendar`), el selector de zona horaria (se mueve desde "Claves"), un interruptor de sincronización y el botón "Desconectar".
  - **Reconexión necesaria:** un aviso y el botón "Reconectar".
- [SettingsDialog.tsx](frontend/src/features/platform/components/SettingsDialog.tsx):
  - Nueva pestaña "Calendario". El grupo `calendar` desaparece de "Claves" y se borra el bloque `calendarRequiredKeys`/`calendarReady` (líneas 125-135 y 185-197).
  - Al volver de Google, se lee `?settings=calendar&google=...`, se abre el diálogo en esa pestaña con un mensaje de éxito o error, y se limpia la query con `history.replaceState`. Hay que ubicar quién abre el `SettingsDialog`, probablemente el layout o la navegación.
- [hooks/useSettings.ts](frontend/src/features/platform/hooks/useSettings.ts) y [api.ts](frontend/src/features/platform/api.ts): agregar `useGoogleCalendarStatus`, `useGoogleCalendars`, `useAuthorizeGoogle`, `useSelectGoogleCalendar` y `useDisconnectGoogle`.
- Regenerar `frontend/src/api/schema.d.ts` con el script de OpenAPI del proyecto.
- El botón "Sincronizar Calendar" de [AppointmentHistoryList.tsx](frontend/src/features/appointments/components/AppointmentHistoryList.tsx) no cambia.

## Configuración en Google Cloud (manual, una sola vez)
1. Crear un proyecto, habilitar la Calendar API y configurar la pantalla de consentimiento (nombre y logo de la plataforma, dominio, política de privacidad).
2. Crear un cliente OAuth de tipo "Aplicación web" con la redirect URI única.
3. **Pasar la app a "En producción" aunque no esté verificada.** En modo "Testing" los refresh tokens vencen a los 7 días. Mientras no esté verificada, el límite es de 100 usuarios y aparece la pantalla de advertencia.
4. Pedir la verificación de los scopes sensibles: justificación y un video mostrando el uso.
5. Cargar el client id, el secret y la redirect URI en el panel de plataforma.

## Fuera de alcance (siguientes pasos)
- Actualizar o borrar el evento cuando la cita cambia o se cancela.
- Evitar duplicados al reintentar, buscando primero por `privateExtendedProperty=crmAppointmentId=<id>`.

Ambos son cambios independientes de este flujo.

## Verificación
- **Tests de backend** en `backend/tests/`, con `httpx` mockeado como en las pruebas de citas existentes:
  - Firmar y verificar el `state`: expirado, firma alterada y nonce reutilizado.
  - El callback guarda la configuración en el tenant correcto y redirige al hostname primario.
  - El callback responde con error si falta el `refresh_token`.
  - Desconectar limpia las claves aunque falle la revocación.
  - `_oauth_client` toma primero las credenciales del negocio y después las de plataforma.
  - `invalid_grant` produce el mensaje de reconexión.
- **Tests de frontend** (vitest): los estados del `GoogleCalendarPanel` (sin plataforma, desconectado, conectado, reconexión) y la lectura de la query de vuelta.
- **Prueba manual de punta a punta:**
  1. En local, con un cliente OAuth de prueba cuya redirect URI sea `http://localhost:<puerto>/api/integrations/google/callback`, conectar una cuenta.
  2. Elegir el calendario y crear una cita: debe aparecer en Google con el link correcto.
  3. Desconectar: la siguiente cita debe quedar `not_configured`.
  4. Revocar el acceso desde myaccount.google.com: la siguiente cita debe mostrar el mensaje de reconexión.
