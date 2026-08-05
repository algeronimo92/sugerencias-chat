# 04 — Plan de testing E2E con Playwright

> Estado: BORRADOR EN CONSTRUCCIÓN (se rellena por secciones).

## Aviso previo: en este repositorio no existe Cypress

**No hay nada que reemplazar.** Se buscó `cypress` en todo el árbol (código,
`frontend/package.json`, `frontend/package-lock.json`, `.github/workflows/`,
los `compose*.yml`) y no aparece ninguna referencia: no existe
`frontend/cypress/`, ni `cypress.config.*`, ni el paquete en dependencias, ni
un job de CI que lo invoque. El único runner de pruebas del frontend es Vitest
(`frontend/vite.config.ts`, bloque `test`), y el del backend es pytest
(`backend/pytest.ini`).

Por lo tanto este documento **no es una migración, es una adopción de
Playwright para E2E desde cero**: hoy el proyecto no tiene ninguna prueba que
arranque un navegador contra la aplicación real. Se incluye igualmente un
apéndice de migración desde Cypress al final, por si existiera una suite fuera
de este repositorio que haya que traer.

## 1. Diagnóstico del estado actual

### 1.1 Cobertura de pytest (backend)

- **Volumen**: 45 archivos en `backend/tests/`, 217 funciones `test_*`.
  Configuración en `backend/pytest.ini` (`asyncio_mode = auto`, `testpaths =
  tests`, `pythonpath = .`).
- **Estilo dominante**: pruebas de *servicio con dobles*, no de API ni de base
  de datos. `backend/tests/conftest.py` construye un `AutomationDeps` completo
  a base de closures (`FakeWhatsApp`, `FakeOutbox`, `Recorder`) para poder
  ejercitar el motor de automatizaciones sin PostgreSQL ni Evolution API. Es un
  diseño muy bueno y hay que conservarlo tal cual.
- **Qué está bien cubierto**:
  - Motor de automatizaciones: `test_automation_actions.py`,
    `test_automation_rules.py`, `test_automation_attempts.py`,
    `test_automation_cancellation.py`, `test_automation_pause.py`,
    `test_automation_throttling.py`, `test_automation_history.py`,
    `test_wait_any.py`, `test_manual_flow_trigger.py`, `test_flow_versions.py`.
  - Identidad de WhatsApp y normalización de teléfonos:
    `test_whatsapp_identity.py`, `test_phone_utils.py`, `test_lead_rekey.py`,
    `test_lead_orphan_fields.py`.
  - Outbox y estado de mensajes: `test_message_outbox_dispatch.py`,
    `test_message_outbox_route.py`, `test_message_status_service.py`,
    `test_message_status_webhook.py`, `test_insert_message_dedup.py`.
  - Multimedia y almacenamiento: `test_media_storage.py`,
    `test_media_roundtrips.py`, `test_media_dimensions.py`,
    `test_media_library_*.py`, `test_media_requires_session.py`.
  - Infraestructura: `test_alembic_setup.py`, `test_bluegreen_config.py`,
    `test_secret_cipher.py`, `test_settings_cache.py`, `test_deletion_safety.py`.
- **Único test que toca la app HTTP real**: `backend/tests/test_media_requires_session.py`,
  con `fastapi.testclient.TestClient` y **sin** `with` (a propósito: el
  `lifespan` de `backend/main.py` intentaría conectar a PostgreSQL y reintentar
  indefinidamente). Es decir: **no existe hoy ninguna prueba de integración de
  API que atraviese router -> servicio -> base de datos**.

### 1.2 Cobertura de Vitest (frontend)

- **Volumen**: 10 archivos de test, ~98 casos. Entorno `jsdom`, setup en
  `frontend/src/test/setup.ts` (dobles de `matchMedia`, `scrollIntoView` y
  `ResizeObserver`; este último expone `ResizeObserverMock.instances` para
  disparar callbacks a mano).
- **Qué cubren**:
  - `frontend/src/components/ChatThread.test.tsx` — render del hilo.
  - `frontend/src/components/FlowPicker.test.tsx` y
    `frontend/src/components/flow/FlowCanvas.test.ts` — constructor de flujos.
  - `frontend/src/hooks/useChats.test.tsx` — parsing y despacho de eventos del
    WebSocket (el archivo más valioso del frontend hoy).
  - `frontend/src/hooks/useThreadScroll.test.tsx`,
    `useEvolutionHistory.test.tsx`, `useFlowHistory.test.ts`,
    `useDismissiblePopover.test.tsx`.
  - `frontend/src/utils/chat.test.ts`, `frontend/src/utils/message.test.ts`.
- **Storybook 10** está instalado (`@storybook/react-vite`, addon a11y) pero
  solo hay **1 archivo `*.stories.*`** en todo `frontend/src`: la inversión
  está hecha y sin usar. `vite.config.ts` excluye explícitamente las stories
  del `include` de Vitest.

### 1.3 Huecos sin cubrir (nadie los prueba, ni pytest ni Vitest)

Ordenados por riesgo de negocio:

1. **Login y sesión completa.** `backend/routers/auth.py` emite una cookie
   `httponly` cuya marca `Secure` se deduce de `X-Forwarded-Proto`
   (`_cookie_is_secure`). No hay ninguna prueba de que la cookie se emita, se
   acepte en `/api/auth/me`, y se borre con los mismos atributos en
   `/api/auth/logout` — un desajuste ahí deja sesiones vivas tras cerrar
   sesión, y solo se detecta en un navegador de verdad.
2. **El WebSocket `/ws/chats` extremo a extremo.** `backend/main.py:302` valida
   la cookie y cierra con `4401`; `frontend/src/hooks/useChats.ts:97` construye
   la URL cambiando `http` por `ws`. Vitest prueba el *parseo* de los payloads,
   pero nadie prueba el canal: que un `POST /api/webhooks/messages` termine
   repintando la lista de chats de un navegador conectado.
3. **Ruta completa de envío de mensaje.** `POST /api/chats/{chat_id}/messages`
   encola en `message_outbox`, y `backend/services/message_outbox.py`
   (`watch_message_outbox`, `IDLE_POLL_SECONDS = 1.0`, `notify_new_work`) lo
   despacha en segundo plano contra Evolution. El *worker* está probado con
   dobles, pero nunca dentro de un proceso FastAPI real con su `lifespan`.
4. **Guardas de rol en el enrutado.** `frontend/src/App.tsx` redirige
   `/templates`, `/media-library`, `/dashboard` y `/automations` a `/` si
   `me.role !== 'admin'`, y el backend además exige `require_admin` en
   `settings_router` y `whatsapp` (`backend/main.py:261-262`). Nadie prueba
   ninguna de las dos capas ni su coherencia.
5. **Kanban con arrastre.** `frontend/src/components/KanbanBoard.tsx` +
   `PATCH /api/chats/{chat_id}/stage` (`backend/routers/chats.py:294`) +
   `POST /api/webhooks/lead-stage`. El drag-and-drop es prácticamente
   imposible de probar de forma creíble en jsdom.
6. **Envío de multimedia y su servido protegido.** `POST
   /api/chats/{chat_id}/media`, `/audio`, `/sticker`, `/location`
   (`backend/routers/chats.py:520-728`) contra MinIO
   (`backend/services/media_storage.py`) y su lectura por `/media/<archivo>`,
   que exige sesión. Hay pruebas de almacenamiento, pero no del recorrido
   subir -> enviar -> ver en el hilo con la cookie del navegador.
7. **Responsive y PWA.** `useLayout()` decide entre `mobile`/`tablet`/`desktop`
   y en móvil monta `MobileNavBar` y el panel deslizable de sugerencias. En
   jsdom `matchMedia` siempre devuelve `matches: false`, así que **la rama
   móvil de `App.tsx` no la ejecuta ninguna prueba**. Igual el service worker
   de `vite-plugin-pwa` (`devOptions.enabled: false`).
8. **Constructor visual de automatizaciones.** `VisualFlowBuilder.tsx` +
   `flow/FlowCanvas.tsx` sobre `@xyflow/react`: arrastrar nodos, conectar
   aristas y publicar una versión. Lo probado hoy son las funciones puras.
9. **Ventana de atención de 24 h.** `useCustomerServiceWindow.ts` +
   `CustomerServiceWindowStatus.tsx` + `GET
   /api/chats/{chat_id}/service-window`: cuando cierra, la UI debe forzar
   plantilla oficial en vez de texto libre. Regla de negocio cara si falla.
10. **Migraciones sobre una base real.** `backend/scripts/migrate.py` toma un
    advisory lock y hace `stamp` de esquemas preexistentes; hay 23 SQL en
    `backend/migrations/` más 9 revisiones en `backend/alembic/versions/`.
    `test_alembic_setup.py` valida la configuración, no una ejecución contra
    PostgreSQL.

### 1.4 Cómo corre todo en CI

`.github/workflows/ci-cd.yml` tiene cuatro jobs:

- `frontend-checks`: Node 22, `npm ci`, `npm run lint` (oxlint), `npm test`
  (Vitest), `npm run build`. Sin servicios.
- `backend-checks`: Python 3.12, `pip install`, `compileall`, un *smoke test*
  de `import main` y `python -m pytest`, todo con
  `DATABASE_URL="postgresql+asyncpg://u:p@localhost/db"` **falso**. El comentario
  del propio workflow lo dice: "Ningún test toca PostgreSQL real: usan dobles".
- `docker-build-check`: construye ambas imágenes y valida `nginx.conf` armando
  una red con un `backend` de mentira.
- `deploy`: solo en `main`, SSH al VPS y `scripts/deploy-bluegreen.sh`.

**Conclusión del diagnóstico**: no hay ningún servicio (Postgres, MinIO) en
CI, ninguna prueba levanta la aplicación completa, y el gate de despliegue se
apoya en pruebas que nunca ejercitan la integración real. Es exactamente el
hueco que Playwright debe cubrir.

## 2. Pirámide objetivo

La pirámide propuesta no reemplaza nada de lo existente: añade un nivel de
integración de API que hoy no existe y una punta E2E deliberadamente estrecha.

| Nivel | Herramienta | Volumen objetivo | Qué vive aquí |
|---|---|---|---|
| Unidad backend | pytest + dobles | ~250 casos (hoy 217) | Lógica pura: reglas y motor de automatizaciones, `phone_utils`, `message_status_service`, `secret_cipher`, `whatsapp_identity_service`, serialización del outbox. **Todo lo que hoy existe se queda.** |
| Unidad frontend | Vitest + Testing Library | ~150 casos (hoy 98) | Hooks y utilidades: `useChats` (parseo de eventos), `useThreadScroll`, `utils/message.ts`, `utils/templates.ts`, `utils/automationFlow.ts`, y componentes con lógica de presentación (`MessageBubble`, `SuggestionCard`, `ScheduledMessageCard`). |
| Integración de API | pytest + `httpx.ASGITransport` + Postgres efímero | 40-60 casos, **nuevo** | Router -> servicio -> base de datos, sin navegador: paginación y filtros de `GET /api/chats`, búsqueda con `unaccent`, `PATCH /stage`, todos los `POST /api/webhooks/*`, `require_admin` en `/api/settings` y `/api/whatsapp`, migraciones de Alembic sobre una base virgen. Es el nivel más rentable y el que hoy falta por completo. |
| Contrato de UI | Storybook 10 + `@storybook/addon-a11y` | ~30 stories | Estados visuales caros de montar: burbuja con cita, tarjeta de referido publicitario (`AdReferralCard`), `FlowRunStatus`, `LeadTaskCard`. Ya está instalado y sin usar. |
| **E2E** | **Playwright** | **15-20 specs** | Solo lo que exige navegador real + backend real + WebSocket: sesión con cookie, tiempo real, arrastre, subida de archivos, layout móvil. |

**Criterios para que un escenario merezca E2E** (si no cumple al menos dos, se
baja de nivel):

1. Cruza al menos dos procesos (navegador + FastAPI, o FastAPI + Postgres/MinIO).
2. Depende de comportamiento que jsdom no simula: cookies reales, WebSocket
   real, `File`/`FormData` real, `matchMedia` real, arrastre con punteros.
3. Es un flujo por el que pasa dinero o la conversación de un paciente
   (enviar, recibir, mover de etapa, agendar).
4. Su rotura sería silenciosa: no la detectaría el build ni un test unitario.

**Qué NO debe ser E2E en este repo** (error habitual y caro):

- Validación de formularios de `LeadFormDialog.tsx` (Zod + react-hook-form):
  Vitest.
- Cálculo de la ventana de 24 h: pytest sobre el servicio, y solo un E2E para
  la consecuencia visible en la UI.
- Combinatoria de filtros de `ChatList.tsx`: integración de API, no E2E.
- Todas las ramas del constructor de flujos: `FlowCanvas.test.ts` ya cubre las
  puras; en E2E solo un camino feliz de publicación.

## 3. Diseño de la suite Playwright

### 3.1 Estructura de carpetas
### 3.2 playwright.config.ts
### 3.3 Datos de prueba y aislamiento
### 3.4 Autenticación con storageState
### 3.5 Simular WhatsApp: mock de Evolution API y webhooks
### 3.6 Esperas por WebSocket sin sleeps
### 3.7 Page Objects y fixtures

## 4. Escenarios E2E priorizados

## 5. Integración en CI

## 6. Plan de adopción por fases

## 7. Ejemplos de código

## Apéndice: guía de migración desde Cypress
