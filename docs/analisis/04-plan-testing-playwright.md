# 04 — Plan de testing E2E con Playwright

> Estado: completo. Secciones 1-2 (diagnóstico y pirámide), 3-7 (diseño de la
> suite, escenarios, CI, adopción y código) y apéndice de migración.

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

La suite vive en un **`e2e/` en la raíz del repositorio**, con su propio
`package.json`, y no dentro de `frontend/`. Tres razones concretas de este
repositorio:

1. Lo que se prueba no es el frontend: es `frontend` + `backend` + PostgreSQL +
   MinIO + el mock de Evolution. Colgarlo de `frontend/` sugiere lo contrario y
   empuja a que alguien acabe importando `../src/...` desde un spec, que es
   justo lo que convierte un E2E en un test unitario disfrazado.
2. `frontend/tsconfig.app.json` tiene `"include": ["src"]` y
   `tsconfig.node.json` solo `vite.config.ts`. Un `frontend/e2e/` quedaría sin
   comprobación de tipos salvo que se añada una tercera referencia de proyecto
   y se toque `npm run build` (`tsc -b && vite build`), que hoy es el gate de
   compilación del despliegue. No conviene meterle nada nuevo a ese comando.
3. El job `frontend-checks` de `.github/workflows/ci-cd.yml` no debe descargar
   navegadores. Separando el `package.json`, `npm ci` en `frontend/` sigue
   costando lo mismo que hoy.

```
e2e/
  package.json                 # @playwright/test, tsx, pg (solo devDeps)
  tsconfig.json
  playwright.config.ts         # ver §7.1
  .env.example                 # E2E_BASE_URL, E2E_API_URL, E2E_DB_URL, INBOUND_WEBHOOK_TOKEN...
  .auth/                       # storageState generado; va a .gitignore
  fixtures/
    test.ts                    # `test` extendido: expone los Page Objects y los helpers
    db.ts                      # cliente `pg` contra la base efímera (seed y verificación)
    lead.ts                    # fixture `lead`: crea un lead aislado por worker
    evolution.ts               # cliente del mock de Evolution (/__mock/sent, /__mock/reset)
    webhooks.ts                # POST a /api/webhooks/* con el INBOUND_WEBHOOK_TOKEN
    realtime.ts                # captura del WebSocket y espera de tramas
  setup/
    auth.setup.ts              # proyecto "setup": login real y volcado de storageState
    seed.setup.ts              # crea el vendedor de pruebas y deja app_settings coherente
  pages/                       # un Page Object por componente real de frontend/src/components
    LoginPo.ts                 # -> components/LoginPage.tsx
    AppShellPo.ts              # -> App.tsx (barra superior, nav, tema, logout)
    ChatListPo.ts              # -> components/ChatList.tsx (+ ChatItem.tsx)
    ChatThreadPo.ts            # -> components/ChatThread.tsx + ChatComposer.tsx
    SuggestionPanelPo.ts       # -> components/SuggestionPanel.tsx
    KanbanBoardPo.ts           # -> components/KanbanBoard.tsx
    TemplatesPo.ts             # -> components/TemplatesPage.tsx + TemplateSendDialog.tsx
    MediaLibraryPo.ts          # -> components/MediaLibraryPage.tsx + MediaLibraryPicker.tsx
    AutomationsPo.ts           # -> components/AutomationsPage.tsx + VisualFlowBuilder.tsx
    TasksPo.ts                 # -> components/TasksPage.tsx
    DashboardPo.ts             # -> components/DashboardPage.tsx
    SettingsDialogPo.ts        # -> components/SettingsDialog.tsx (+ UsersPanel, WhatsappPanel)
    MobileNavBarPo.ts          # -> components/MobileNavBar.tsx
    NotificationCenterPo.ts    # -> components/NotificationCenter.tsx
  specs/
    auth/        sesion.spec.ts, roles.spec.ts
    chat/        enviar-texto.spec.ts, recibir-mensaje.spec.ts, plantillas.spec.ts,
                 ventana-24h.spec.ts, citar-y-reaccionar.spec.ts
    kanban/      arrastrar-etapa.spec.ts
    media/       enviar-imagen.spec.ts, biblioteca.spec.ts
    automations/ publicar-flujo.spec.ts
    realtime/    reconexion.spec.ts, estados-de-mensaje.spec.ts
    mobile/      navegacion.spec.ts, pwa.spec.ts
  mocks/
    evolution/   Dockerfile + server.ts  (mock HTTP de Evolution API)
compose.e2e.yml                # en la raíz, junto a compose.yml / compose.db.yml
```

`compose.e2e.yml` se añade **junto a los compose existentes y sin tocarlos**:
`compose.yml` es desarrollo con hot reload contra la base de producción (lo
dice su cabecera), `compose.db.yml` monta TLS obligatorio con certificados que
genera cada servidor (`scripts/gen-db-tls.sh`), y `compose.prod.yml` es
blue-green. Ninguno sirve para CI. El de E2E levanta cinco servicios:
`postgres` (misma imagen `postgres:16.10-alpine` que `compose.db.yml`, pero sin
`ssl=on` ni el `db/pg_hba.conf`), `minio`, `evolution-mock`, `backend` y
`frontend` (imagen `--target prod`, es decir nginx sirviendo `dist`).

### 3.2 playwright.config.ts

El archivo completo está en **§7.1**. Aquí solo las decisiones y por qué son
estas y no las de la plantilla por defecto.

| Decisión | Valor | Motivo específico de este repo |
|---|---|---|
| `baseURL` | `http://localhost:8080` (nginx de `--target prod`) | La topología real es navegador -> nginx -> backend. `frontend/nginx.conf` proxea `/api/`, `/media/` y `/ws/` al backend, así que **todo es mismo origen**: la cookie `SameSite=Lax` de `backend/routers/auth.py` viaja en `<img>`/`<audio>` y el WebSocket relativo funciona. Probar contra `vite dev` en :5173 con el backend en :8000 mete CORS con credenciales en medio, que no es lo que corre en producción. |
| Proyecto `setup` | `testMatch: /.*\.setup\.ts/` | Hace login una vez por rol y deja `e2e/.auth/*.json`. Todos los demás proyectos lo declaran en `dependencies`. |
| Proyecto `chromium` | `devices['Desktop Chrome']`, 1440x900, `storageState: .auth/admin.json` | Es el layout `desktop` de `useLayout()`: las tres columnas, con `SuggestionPanel` fijo. |
| Proyecto `chromium-vendedor` | mismo, con `.auth/vendedor.json`, `testMatch: **/roles.spec.ts` | Las guardas de `App.tsx` (`me.role === 'admin'`) y `require_admin` de `backend/main.py:261-262` solo se pueden probar con una segunda sesión. |
| Proyecto `mobile-chrome` | `devices['Pixel 7']`, `testDir: specs/mobile` | `useLayout()` devuelve `mobile` y monta `MobileNavBar`; con `matchMedia` real. Es la rama de `App.tsx` que hoy no ejecuta ninguna prueba (hueco 7 de §1.3). |
| `webkit` | fuera del run por defecto, en un job nocturno | Aporta poco por caso de uso (el CRM se usa en Chrome de escritorio y Android) y duplica el tiempo de CI. |
| `retries` | `process.env.CI ? 2 : 0` | Con `trace: 'on-first-retry'` el reintento es lo que produce la traza del fallo. |
| `workers` | `process.env.CI ? 2 : undefined` | Comparten una sola base; el aislamiento lo da el namespacing por worker (§3.3), no la serialización. Más de 2 no compensa: el cuello es el backend, no el navegador. |
| `fullyParallel` | `true`, salvo `specs/realtime/reconexion.spec.ts` con `test.describe.configure({ mode: 'serial' })` | `manager.broadcast` de `services/ws_manager.py` va a **todas** las conexiones: un evento de otro worker provoca un refetch en la página de este. Es inofensivo mientras cada aserción esté acotada a su propio lead, pero el spec que corta la red y cuenta reconexiones sí necesita quedarse solo. |
| `timeout` / `expect.timeout` | 45 s / 10 s | `services/message_outbox.py` tiene `IDLE_POLL_SECONDS = 1.0` y el backend arranca con `_wait_for_database` + `_verify_schema_is_current`. Los 5 s por defecto de `expect` se quedan cortos para "el mensaje pasó a SERVER_ACK". |
| `trace` / `video` / `screenshot` | `on-first-retry` / `retain-on-failure` / `only-on-failure` | Grabar siempre multiplica por diez el peso de los artefactos sin aportar nada en los runs verdes. |
| `reporter` | `html` (sin abrir), `github`, `junit` | `github` anota el fallo en el diff del PR; `junit` alimenta el resumen del job. |
| `webServer` | `docker compose -f ../compose.e2e.yml up -d --wait`, `reuseExistingServer: !process.env.CI` | En local levanta la pila sola; en CI ya está arriba y el `--wait` sirve de puerta. La URL de sondeo es `http://localhost:8000/health/ready` (nginx **no** proxea `/health`, solo `/api/`, `/media/` y `/ws/`) — un detalle que cuesta media hora si se descubre por ensayo y error. |

### 3.3 Datos de prueba y aislamiento

**La base se crea y se tira con el run.** No se apunta nunca a la base de
producción, que es exactamente lo que hace `compose.yml` hoy en desarrollo.

**Migraciones, no `create_all`.** `backend/main.py` aborta el arranque con
`SchemaNotMigratedError` si `alembic_version` no coincide con el head de
`backend/alembic/versions/`. La pila de E2E ejecuta, antes del backend,
`python -m scripts.migrate` — el mismo comando que corre el despliegue
(`scripts/deploy-bluegreen.sh`). Efecto colateral valioso: **cada run de E2E
prueba las migraciones sobre una base virgen**, que es el hueco 10 de §1.3, sin
escribir un solo test para ello.

**Extensión `unaccent`.** `backend/migrations/020_search_unaccent.sql` crea
`f_unaccent`, y `_detect_search_capabilities()` degrada a `ILIKE` si no está.
La imagen `postgres:16.10-alpine` permite `CREATE EXTENSION unaccent` como
superusuario, así que la migración se aplica entera y las pruebas de búsqueda
ejercitan la ruta buena. Si algún día no fuera así, el log del backend lo dice
y hay que fallar el run en vez de dejar que la búsqueda pase por la rama
degradada sin avisar.

**Usuarios.** El admin lo crea el propio arranque:
`seed_admin_if_needed(...)` se dispara desde el `lifespan` cuando
`ADMIN_EMAIL`/`ADMIN_PASSWORD` están definidos y la tabla `users` está vacía.
El vendedor se crea en `seed.setup.ts` con `POST /api/users` (router
`backend/routers/users.py`, `dependencies=[Depends(require_admin)]`) usando la
sesión de admin. Nada de INSERT a mano: así el propio seed valida el endpoint.

**Leads: creados por API, nunca por UI.** Montar el estado a golpe de clics
convierte cada spec en un test de todos los formularios de la aplicación. Dos
caminos, según lo que se quiera probar:

- Lead "del CRM": `POST /api/chats` (`backend/routers/chats.py:332`), que es lo
  que hace `LeadFormDialog.tsx`.
- Lead "de WhatsApp": `POST /api/webhooks/resolve-whatsapp-identity` con un
  `remoteJid`. Devuelve el `chat_id` canónico y deja la fila en
  `whatsapp_identities`, igual que hace n8n antes de escribir el mensaje. Es el
  camino correcto para todo lo que después vaya a recibir mensajes entrantes.

**Namespacing por worker en vez de limpieza.** No existe endpoint para borrar
un lead —y no hay que inventarlo solo para los tests—, así que el aislamiento
es por nombre:

```ts
const tag = `E2E-W${test.info().parallelIndex}-${randomUUID().slice(0, 8)}`
```

Ese `tag` va en `nombre` del lead y en el JID (`51900${digits}@s.whatsapp.net`).
Toda aserción sobre `ChatList` filtra primero por el buscador
(`getByPlaceholder('Buscar lead...')`) con ese `tag`, de modo que dos workers
pueden trabajar sobre la misma base sin verse. Regla dura: **ningún spec puede
afirmar sobre "el primer chat de la lista" ni sobre contadores globales**
(`unread_count` de la cabecera, tarjetas del `DashboardPage`) salvo que se haya
declarado `test.describe.configure({ mode: 'serial' })` y el worker sea único.

**Limpieza.** Tres niveles, de menor a mayor coste:

1. Por test: los efectos que sí tienen endpoint de deshacer se revierten en el
   `finally` de la fixture (etiquetas con `DELETE /api/chats/{id}/tags/{tag}`,
   plantillas con `DELETE /api/templates/{id}`, reglas con
   `DELETE /api/automations/{id}`).
2. Por run: `globalTeardown` vuelca `docker compose -f compose.e2e.yml logs
   backend` a `e2e/artifacts/backend.log` — un fallo de E2E casi siempre se
   explica ahí y no en la traza del navegador.
3. Por pila: `docker compose -f compose.e2e.yml down -v`. El `-v` es la
   limpieza de verdad; en CI el runner es efímero y basta con eso.

**Fechas.** Nada de `page.clock` para la ventana de 24 h. La ventana la calcula
el backend (`GET /api/chats/{chat_id}/service-window`) a partir de `sent_at` en
PostgreSQL: adelantar el reloj del navegador no la mueve. Se manipula el dato,
insertando el último mensaje del cliente con `sent_at = now() - interval '25
hours'` desde la fixture `db`.

### 3.4 Autenticación con storageState

`backend/routers/auth.py` emite una cookie `access_token` (`COOKIE_NAME` en
`services/auth_service.py:12`) `httponly`, `samesite=lax`, con `secure`
deducido de `X-Forwarded-Proto` y `max_age = access_token_expire_hours * 3600`
(24 h por defecto). Playwright captura cookies `httpOnly` en
`context.storageState()`, así que el patrón estándar aplica sin adaptaciones.

- `setup/auth.setup.ts` hace login **por la UI real** (`LoginPo`), no por
  `POST /api/auth/login`. Cuesta un par de segundos una vez por run y a cambio
  el camino de login está cubierto en todos los runs, incluida la parte que
  falla de forma silenciosa: que la cookie que emite el backend sea aceptada
  por el navegador tal como la manda nginx.
- Se generan dos estados: `.auth/admin.json` y `.auth/vendedor.json`. Los
  proyectos los consumen con `storageState` y `dependencies: ['setup']`.
- El spec de sesión (`specs/auth/sesion.spec.ts`) **no** puede heredarlos:
  declara `test.use({ storageState: { cookies: [], origins: [] } })` y empieza
  desde el login. Es el único que prueba logout, y tiene que comprobar la
  cookie por sus atributos, no por que la UI muestre el login:

  ```ts
  const cookies = await context.cookies()
  expect(cookies.find(c => c.name === 'access_token')).toBeUndefined()
  ```

  Ese assert es el que detecta el desajuste de atributos entre `set_cookie` y
  `delete_cookie` que describe el hueco 1 de §1.3, y que ninguna otra capa ve.
- La expiración (24 h) es más larga que cualquier run, así que no hace falta
  refrescar el `storageState` entre proyectos. Sí conviene que el proyecto
  `setup` no se cachee entre runs de CI: es barato y evita depurar una sesión
  caducada del run anterior.

### 3.5 Simular WhatsApp: mock de Evolution API y webhooks

Son dos direcciones distintas y se resuelven con mecanismos distintos.
Confundirlas es el error clásico.

**Salida (la app manda a WhatsApp).** La petición sale del **backend**, no del
navegador: `page.route()` no la ve. El único punto de corte correcto es la URL
de Evolution.

- `backend/services/evolution_service.py::_config()` lee la configuración con
  `get_effective_many(("evolution_api_url", "evolution_api_key",
  "evolution_instance"))`, es decir **`app_settings` pisa a las variables de
  entorno**. Por eso `seed.setup.ts` debe dejar `app_settings` sin overrides de
  `evolution_*` (o escribirlos apuntando al mock). Si alguien restaura un dump
  de producción en la base de E2E, ese es el fallo que hace que un test mande
  un WhatsApp de verdad.
- El mock (`e2e/mocks/evolution/server.ts`, un servidor HTTP de 60 líneas)
  implementa lo que consume el repo —`/message/sendText/{instance}`,
  `sendMedia`, `sendWhatsAppAudio`, `sendSticker`, `sendLocation`,
  `sendTemplate`, `sendList`, `sendButtons`, `message/sendReaction`,
  `chat/findContacts`, `instance/connectionState`— devolviendo
  `{ key: { id: 'MOCK-<uuid>', remoteJid, fromMe: true } }`, que es lo que
  `services/message_outbox.py` necesita para grabar el `wa_message_id`.
- Añade una superficie de control fuera del contrato de Evolution:
  `GET /__mock/sent` (lo enviado, para aserciones de servidor),
  `POST /__mock/reset`, y `POST /__mock/fail-next` para forzar un 500 y probar
  el reintento del outbox y el botón "Reintentar" de `MessageBubble`.
- Un mock explícito es preferible a WireMock/MockServer aquí: son ocho rutas,
  se necesita estado consultable, y el contenedor arranca en menos de un
  segundo.

**Entrada (WhatsApp manda a la app).** Se reproduce literalmente lo que hace
n8n hoy, que está documentado en `docs/analisis/03-arquitectura-y-flujo-de-eventos.md`:

1. `POST /api/webhooks/resolve-whatsapp-identity` con el `remoteJid` -> devuelve
   el `chat_id` canónico (UUID de `leads.id`).
2. `INSERT INTO wsp_messages (chat_id, sender, content, sent_at, wa_message_id,
   message_type) VALUES (..., 'cliente', ...)` desde la fixture `db`. Este paso
   es SQL a propósito: **n8n también escribe directo en la tabla**, no hay
   endpoint de inserción de entrantes y fabricar uno para los tests probaría
   algo que en producción no existe.
3. `POST /api/webhooks/messages` con `{ "wa_message_id": "..." }`, que es lo que
   dispara `manager.broadcast` y `trigger_inbound_message`.

Los webhooks van protegidos por `verify_webhook_token`
(`services/auth_service.py:106-118`), que acepta `Authorization: Bearer <token>`
o la cabecera `X-Webhook-Token`, y **no comprueba nada si el token configurado
está vacío** (bug A-1 de `docs/analisis/02-bugs.md`). La suite de E2E toma
posición sobre esto: en `compose.e2e.yml` `INBOUND_WEBHOOK_TOKEN` vale
`e2e-inbound-token`, la fixture `webhooks` lo manda siempre, y un caso del
plan (§4, escenario 15) afirma que **sin** el token la respuesta es 401. El día
que alguien arregle A-1 obligando a que el token no esté vacío, la suite sigue
verde; el día que alguien lo rompa al revés, se pone roja.

El resto de webhooks se usan igual desde la fixture: `/message-status` para los
tildes de entregado y leído, `/reaction` para el badge de emoji, `/lead-stage`
para el cambio de etapa hecho por el agente analista, y `/outgoing` para un
saliente escrito desde el teléfono del vendedor.

### 3.6 Esperas por WebSocket sin sleeps

Regla: **`page.waitForTimeout` está prohibido en `e2e/`**, y se hace cumplir con
una regla de lint en `e2e/.oxlintrc.json`. Sustitutos, en orden de preferencia:

1. **Aserción web-first sobre la consecuencia visible.** Es la que hay que usar
   el 90 % de las veces, porque reintenta sola:
   `await expect(thread.bubble('Hola')).toBeVisible()`.
2. **Sincronizar con la trama concreta del WebSocket** cuando el spec necesita
   distinguir "llegó por WebSocket" de "llegó por un refetch". Sirve
   `webSocket.waitForEvent('framereceived', ...)`, y la promesa se crea
   **antes** de disparar el webhook, si no hay carrera:

   ```ts
   const framePromise = realtime.waitForFrame(
     e => e.type === 'chats_updated' && e.chat_id === lead.chatId && e.reason === 'inbound_message',
   )
   await webhooks.inboundMessage(lead, 'Hola, quiero información')
   await framePromise
   await expect(chatList.item(lead.tag)).toContainText('Hola, quiero información')
   ```

   El `WebSocket` se captura con `page.on('websocket')` en la fixture, montado
   antes del primer `goto`, porque `useChatUpdates` conecta en el primer render.
3. **`page.waitForResponse`** para las mutaciones con endpoint claro, por
   ejemplo `PATCH /api/chats/{id}/stage` tras soltar una tarjeta del Kanban.
4. **Sondeo con `expect.poll`** contra el estado del servidor cuando la
   consecuencia no es visual: por ejemplo que el outbox haya despachado
   (`expect.poll(() => evolution.sent()).toHaveLength(1)`), teniendo en cuenta
   que `IDLE_POLL_SECONDS = 1.0` marca el peor caso.

Dos detalles del código que juegan a favor y conviene aprovechar:

- Mientras el socket está conectado, `useChats` **no** hace polling
  (`refetchInterval` desactivado, comentado en `routers/webhooks.py:241`). Es
  decir: si la UI se actualiza, fue por el WebSocket. Sin esa propiedad, un
  test de tiempo real no probaría tiempo real, solo paciencia.
- El heartbeat es de 25 s (`PING_INTERVAL_MS` en `hooks/useChats.ts`) con
  watchdog a los 40 s. Ningún test debería depender de esos plazos salvo el de
  reconexión, que fuerza la caída con `context.setOffline(true)` y comprueba la
  recuperación con la trama `notifications_updated` que `main.py:312` envía
  nada más aceptar la conexión — es la señal de "socket nuevo listo", mucho más
  rápida y estable que esperar al watchdog.

### 3.7 Page Objects y fixtures

**Punto de partida incómodo: hoy no hay un solo `data-testid` en
`frontend/src/components`** (solo aparecen en dos archivos de test de hooks).
Los selectores se apoyan, por este orden, en rol accesible, etiqueta,
`placeholder` y texto; ya existen buenos anclajes porque los componentes están
razonablemente etiquetados. Solo donde no hay ningún asidero —las columnas del
Kanban, las burbujas del hilo— se propone añadir un `data-testid`, en un PR
aparte y mínimo, antes de escribir el spec correspondiente.

| Page Object | Componente real | Anclajes que ya existen |
|---|---|---|
| `LoginPo` | `components/LoginPage.tsx` | `getByLabel('Email')`, `getByLabel('Contraseña')` (`htmlFor="login-email"`/`login-password`), `getByRole('button', { name: 'Entrar' })`, `getByLabel('Mostrar contraseña')` |
| `AppShellPo` | `App.tsx` | `getByRole('navigation', { name: 'Vista principal' })`, `getByLabel('Configuración')`, `getByLabel('Cerrar sesión')`, `getByLabel('Activar modo oscuro')` |
| `ChatListPo` | `components/ChatList.tsx`, `ChatItem.tsx` | `getByPlaceholder('Buscar lead...')`, `getByRole('group', { name: 'Filtrar leads' })`, `getByLabel('Agregar lead')`, `getByLabel('Cargando leads')`, `getByPlaceholder('Inactivo (días)')` |
| `ChatThreadPo` | `components/ChatThread.tsx`, `ChatComposer.tsx` | `getByPlaceholder('Escribí un mensaje... (/ para usar una plantilla)')`, `getByLabel('Enviar mensaje')`, `getByLabel('Volver a la lista de chats')`, `getByLabel('Ir al último mensaje')`, `getByLabel('Ver sugerencias del lead')`, `getByLabel('Cerrar conversación')`, `getByLabel('Pausar automatización para este chat')`, `getByLabel('Cancelar respuesta')` |
| `KanbanBoardPo` | `components/KanbanBoard.tsx` | `getByLabel('Abrir chat de <nombre>')`, `getByLabel('Seleccionar <nombre>')`, `getByPlaceholder('Buscar lead, servicio o mensaje...')`; las columnas por las etiquetas de `domain/leadStageMeta.ts` ("Nuevo", "En diagnóstico", "Calificado", "Agendado", "Perdido"...) |
| `SuggestionPanelPo` | `components/SuggestionPanel.tsx`, `SuggestionCard.tsx` | CTA "Generá sugerencias" / "Generá otras" |
| `TemplatesPo` | `components/TemplatesPage.tsx`, `TemplatePicker.tsx`, `TemplateSendDialog.tsx` | Diálogos de Radix: `getByRole('dialog')` + nombre |
| `MediaLibraryPo` | `components/MediaLibraryPage.tsx`, `MediaLibraryPicker.tsx`, `AttachMenu.tsx` | `setInputFiles` sobre el `input[type=file]` oculto |
| `AutomationsPo` | `components/AutomationsPage.tsx`, `VisualFlowBuilder.tsx`, `flow/FlowCanvas.tsx` | Nodos de `@xyflow/react`: `.react-flow__node`, `.react-flow__handle`, `.react-flow__edge` |
| `SettingsDialogPo` | `components/SettingsDialog.tsx`, `UsersPanel.tsx`, `WhatsappPanel.tsx` | Pestañas `claves` / `whatsapp` / `usuarios` (ver `initialTab` en `App.tsx`) |
| `MobileNavBarPo` | `components/MobileNavBar.tsx` | `getByRole('navigation', { name: 'Vista principal' })`, `getByRole('dialog', { name: 'Más vistas' })` |
| `NotificationCenterPo` | `components/NotificationCenter.tsx` | Campana de la barra superior |

Convenciones de los Page Objects, para que no degeneren:

- **Exponen `Locator`, no ejecutan aserciones.** Las aserciones viven en el
  spec; si no, un fallo apunta al Page Object y no al caso de negocio.
- **Nada de esperas dentro**: los locators de Playwright ya son perezosos y
  reintentan.
- **Un método = una acción de usuario** (`enviarTexto`, `abrirLead`,
  `moverA(etapa)`), nombrada como la acción, no como el DOM.
- Constructor `(page: Page)` y nada más: sin estado propio, sin caché de datos.

**Fixtures** (`e2e/fixtures/test.ts`, código en §7.2):

| Fixture | Ámbito | Qué da |
|---|---|---|
| `db` | worker | Cliente `pg` contra `E2E_DB_URL`; usado para insertar entrantes y envejecer `sent_at`. |
| `api` | test | `APIRequestContext` con el `storageState` del rol activo, para montar estado por endpoints. |
| `webhooks` | test | `inboundMessage()`, `messageStatus()`, `reaction()`, `leadStage()`, `outgoing()`, todos con el `INBOUND_WEBHOOK_TOKEN`. |
| `evolution` | test | `sent()`, `reset()`, `failNext()` contra el mock; se resetea en el `beforeEach`. |
| `lead` | test | Crea un lead aislado (`tag`, `chatId`, `jid`, `phone`) y revierte lo que tiene endpoint de deshacer. |
| `realtime` | test | Captura del `WebSocket` de la página y `waitForFrame(predicado)`. |
| `chatList`, `chatThread`, `kanban`, ... | test | Los Page Objects, ya construidos sobre `page`. |

## 4. Escenarios E2E priorizados

Dieciséis escenarios, ordenados por lo que cuesta que fallen en producción.
Cada uno declara qué criterio de §2 cumple; los que no cumplen al menos dos no
están en esta lista. La columna "P" es la prioridad de implementación (P0 =
fase 1, ver §6).

| # | Escenario | P | Proyecto | Spec |
|---|---|---|---|---|
| 1 | Login, sesión persistente y logout | P0 | chromium | `specs/auth/sesion.spec.ts` |
| 2 | Enviar un texto y verlo llegar a Evolution | P0 | chromium | `specs/chat/enviar-texto.spec.ts` |
| 3 | Mensaje entrante repinta la lista por WebSocket | P0 | chromium | `specs/chat/recibir-mensaje.spec.ts` |
| 4 | Tildes de entregado y leído | P0 | chromium | `specs/realtime/estados-de-mensaje.spec.ts` |
| 5 | Reintento tras un fallo de Evolution | P0 | chromium | `specs/chat/enviar-texto.spec.ts` |
| 6 | Guardas de rol: vendedor contra rutas de admin | P0 | chromium-vendedor | `specs/auth/roles.spec.ts` |
| 7 | Kanban: arrastrar una tarjeta de etapa | P1 | chromium | `specs/kanban/arrastrar-etapa.spec.ts` |
| 8 | Subir una imagen y verla servida por `/media/` | P1 | chromium | `specs/media/enviar-imagen.spec.ts` |
| 9 | Ventana de 24 h vencida | P1 | chromium | `specs/chat/ventana-24h.spec.ts` |
| 10 | Enviar una plantilla con adjunto | P1 | chromium | `specs/chat/plantillas.spec.ts` |
| 11 | Reconexión del WebSocket tras corte de red | P1 | chromium (serial) | `specs/realtime/reconexion.spec.ts` |
| 12 | Layout móvil: lista, chat y barra inferior | P1 | mobile-chrome | `specs/mobile/navegacion.spec.ts` |
| 13 | Citar un mensaje y reaccionar con emoji | P2 | chromium | `specs/chat/citar-y-reaccionar.spec.ts` |
| 14 | Publicar un flujo de automatización | P2 | chromium | `specs/automations/publicar-flujo.spec.ts` |
| 15 | Webhooks sin token: 401 | P2 | chromium | `specs/auth/webhook-token.spec.ts` |
| 16 | Mención en nota interna avisa al mencionado | P2 | chromium | `specs/realtime/mencion.spec.ts` |

---

**1. Login, sesión persistente y logout**

- *Flujo*: `LoginPage.tsx` -> `POST /api/auth/login` -> cookie `access_token`
  -> `GET /api/auth/me` -> `AuthGate` renderiza `MainLayout` -> logout.
- *Pasos*: partir sin `storageState`; escribir credenciales incorrectas y
  enviar; corregirlas y entrar; recargar la página; pulsar "Cerrar sesión".
- *Aserciones*: con credenciales malas, aparece el texto "Email o contraseña
  incorrectos" y **no** hay cookie; tras entrar, `context.cookies()` contiene
  `access_token` con `httpOnly: true`, `sameSite: 'Lax'` y `path: '/'`; tras
  recargar sigue la sesión (no vuelve el formulario); tras el logout la cookie
  **desaparece** de `context.cookies()` y se ve otra vez el botón "Entrar".
- *Por qué E2E*: criterios 1, 2 y 4. Es el hueco 1 de §1.3 en estado puro. El
  `secure` de `_cookie_is_secure()` sale de `X-Forwarded-Proto`, que lo pone
  `frontend/nginx.conf`; y el borrado de `delete_cookie` solo funciona si sus
  atributos coinciden con los del `set_cookie`. Nada de eso existe en jsdom:
  un unit test que llame a `login()` pasa aunque el navegador real conserve la
  sesión tras cerrarla.

**2. Enviar un texto y verlo llegar a Evolution**

- *Flujo*: `ChatComposer.tsx` -> `POST /api/chats/{chat_id}/messages` -> fila en
  `message_outbox` -> `watch_message_outbox` -> mock de Evolution -> `wa_message_id`
  grabado -> broadcast -> burbuja con tilde.
- *Pasos*: abrir el lead de la fixture; escribir en el campo "Escribí un
  mensaje..."; pulsar "Enviar mensaje".
- *Aserciones*: la burbuja aparece **inmediatamente** con el indicador
  `aria-label="Enviando"` (estado `PENDING`); en menos de 15 s pasa a
  `aria-label="Enviado"`; `GET /__mock/sent` devuelve exactamente una llamada a
  `/message/sendText/{instance}` con el texto y el JID correctos; en
  `message_outbox` la fila queda en estado despachado.
- *Por qué E2E*: criterios 1, 3 y 4. Es el hueco 3 de §1.3. El worker del outbox
  está probado con dobles en `backend/tests/test_message_outbox_dispatch.py`,
  pero **nunca dentro de un proceso FastAPI con su `lifespan`**: que la tarea
  `asyncio.create_task(watch_message_outbox())` de `main.py:198` esté viva y
  despierte con `notify_new_work()` solo se comprueba corriendo la aplicación.

**3. Mensaje entrante repinta la lista por WebSocket**

- *Flujo*: `resolve-whatsapp-identity` -> INSERT en `wsp_messages` ->
  `POST /api/webhooks/messages` -> `manager.broadcast` -> `useChatUpdates`
  invalida las queries -> `ChatList` y `ChatThread` repintan.
- *Pasos*: con el lead abierto en pantalla, disparar un entrante desde la
  fixture `webhooks`; repetir con el lead **cerrado** (estando en la lista).
- *Aserciones*: con el hilo abierto, la burbuja del cliente aparece sin
  recargar; con el hilo cerrado, el `ChatItem` sube en la lista, muestra el
  texto como último mensaje y el globo de no leídos pasa de 0 a 1; la trama
  recibida por el socket tiene `reason: 'inbound_message'` y el `chat_id` del
  lead.
- *Por qué E2E*: criterios 1, 2 y 3. Es el hueco 2 de §1.3.
  `useChats.test.tsx` prueba el *parseo* de esos payloads con un WebSocket
  falso; nadie prueba que la trama llegue. Y como el polling está desactivado
  mientras el socket vive, si el canal se rompe la UI se queda muda sin ningún
  error visible: rotura silenciosa de manual.

**4. Tildes de entregado y leído**

- *Flujo*: `POST /api/webhooks/message-status` (formato nativo `MESSAGES_UPDATE`,
  con estados numéricos) -> `update_message_status` -> broadcast con
  `message_statuses` -> `MessageBubble` cambia el icono.
- *Pasos*: enviar un texto (escenario 2) y capturar su `wa_message_id` desde
  `/__mock/sent`; mandar el webhook con estado 3 (`DELIVERY_ACK`) y después con
  4 (`READ`); por último un lote con dos ids a la vez.
- *Aserciones*: el indicador de la burbuja pasa de `aria-label="Enviado"` a
  `"Entregado"` y luego a `"Leído"`, sin recargar; el lote actualiza las dos
  burbujas con un solo broadcast.
- *Por qué E2E*: criterios 1, 2 y 3. `parse_message_status_events` ya está
  cubierto en pytest, pero el trayecto *webhook -> broadcast selectivo ->
  merge en la caché de React Query* (`applyMessageStatuses` en `useChats.ts`)
  solo se prueba entero con navegador. Es además el bug más caro de detectar a
  ojo: un tilde equivocado no rompe nada, solo miente.

**5. Reintento tras un fallo de Evolution**

- *Flujo*: `POST /__mock/fail-next` -> el envío falla -> el outbox reintenta y
  agota -> la burbuja queda `FAILED` -> el vendedor pulsa reintentar ->
  `POST /api/chats/{chat_id}/messages/{message_id}/retry`.
- *Pasos*: armar el mock para que devuelva 500; enviar; esperar el estado
  fallido; pulsar el botón "No se pudo confirmar el envío. Reintentar".
- *Aserciones*: aparece el botón con ese `aria-label` exacto; tras pulsarlo el
  mensaje vuelve a `Enviando` y termina en `Enviado`; `/__mock/sent` registra
  dos intentos; no se duplica la burbuja en el hilo.
- *Por qué E2E*: criterios 1, 3 y 4. Cubre el camino de error del outbox
  atravesando la UI, que es donde el vendedor lo vive. Un unit test del worker
  no dice nada sobre si el botón de reintento existe y si el mensaje se
  duplica al pulsarlo.

**6. Guardas de rol: vendedor contra rutas de admin**

- *Flujo*: `App.tsx` redirige `/templates`, `/media-library`, `/dashboard` y
  `/automations` a `/` si `me.role !== 'admin'`; el backend además exige
  `require_admin` en `settings_router` y `whatsapp` (`main.py:261-262`).
- *Pasos*: con la sesión de vendedor, navegar directo a las cuatro rutas;
  comprobar la barra superior; llamar a `GET /api/settings` y
  `GET /api/users` con el `APIRequestContext` de esa misma sesión.
- *Aserciones*: la URL acaba en `/` en los cuatro casos; el botón
  "Configuración" no está en el DOM; `visibleNavItems(false)` no ofrece esas
  pestañas; las dos llamadas de API devuelven 403.
- *Por qué E2E*: criterios 1 y 4. Es el hueco 4 de §1.3, y lo importante es la
  **coherencia entre las dos capas**: hoy nadie prueba ninguna, y una guarda
  de router sin su equivalente en el backend es una fuga de datos con aspecto
  de estar resuelta.

**7. Kanban: arrastrar una tarjeta de etapa**

- *Flujo*: `KanbanBoard.tsx` (HTML5 drag con `dataTransfer.setData('text/plain',
  chat_id)`) -> `PATCH /api/chats/{chat_id}/stage` -> `update_lead_stage` ->
  `lead_activity` -> broadcast `stage_changed`.
- *Pasos*: ir a `/kanban`; buscar el lead por su `tag`; arrastrar su tarjeta de
  la columna "Nuevo" a "Agendado" con `locator.dragTo`; recargar.
- *Aserciones*: la tarjeta queda en la columna destino y desaparece de la
  origen; el `PATCH` respondió 200 (`waitForResponse`); tras recargar sigue en
  "Agendado"; `GET /api/chats/{chat_id}/activity` incluye la entrada de cambio
  de etapa.
- *Por qué E2E*: criterios 1, 2 y 3. Es el hueco 5 de §1.3. El arrastre nativo
  de HTML5 no se puede simular de forma creíble en jsdom —`dataTransfer` no
  existe— y Playwright sí lo reproduce con eventos de puntero reales en
  Chromium. Mover un lead de etapa dispara automatizaciones: es dinero.

**8. Subir una imagen y verla servida por `/media/`**

- *Flujo*: `AttachMenu.tsx` -> `input[type=file]` -> `POST /api/chats/{chat_id}/media`
  -> `services/media_storage.py` (MinIO) -> outbox -> `/media/<archivo>` con la
  cookie -> `MediaLightbox.tsx`.
- *Pasos*: adjuntar un PNG pequeño con `setInputFiles`; confirmar el envío en
  `MediaPreviewDialog`; abrir la imagen del hilo.
- *Aserciones*: la burbuja de imagen aparece; la petición a `/media/<archivo>`
  devuelve 200 con `Cache-Control: private`; **la misma URL sin cookie devuelve
  401** (se comprueba con un `APIRequestContext` limpio); el objeto existe en
  el bucket de MinIO; `/__mock/sent` registra el `sendMedia`.
- *Por qué E2E*: criterios 1, 2 y 3. Es el hueco 6 de §1.3. Hace falta un
  `File` real, un `FormData` real y una cookie real viajando en la petición de
  la etiqueta `<img>`; ninguna de las tres cosas existe en jsdom, y
  `test_media_requires_session.py` solo cubre el 401 sin llegar a la subida.

**9. Ventana de 24 h vencida**

- *Flujo*: `useCustomerServiceWindow.ts` -> `GET /api/chats/{chat_id}/service-window`
  -> `CustomerServiceWindowStatus.tsx`.
- *Pasos*: envejecer con la fixture `db` el último mensaje del cliente
  (`sent_at = now() - interval '25 hours'`); abrir el hilo; después crear un
  lead sin ningún mensaje del cliente y abrirlo; por último dejar un entrante
  a 23 h para el aviso ámbar.
- *Aserciones*: con 25 h aparece "Venció el plazo de 24 h para responder"; sin
  mensajes del cliente, "Todavía no te escribió"; a 23 h, el aviso "Quedan ...
  para responder". El `ChatComposer` sigue habilitado en los tres casos: hoy
  la UI **avisa, no bloquea**, y el E2E fija ese comportamiento observado para
  que un cambio futuro sea deliberado.
- *Por qué E2E*: criterios 1 y 3. Es el hueco 9 de §1.3 reducido a su
  consecuencia visible, tal como pide §2: el cálculo del plazo se prueba en
  pytest, aquí solo se prueba que el vendedor lo vea.

**10. Enviar una plantilla con adjunto**

- *Flujo*: atajo `/` en `ChatComposer` -> `TemplatePicker.tsx` ->
  `TemplateSendDialog.tsx` -> `POST /api/chats/{chat_id}/templates/{template_id}`
  (`routers/chats.py:623`, devuelve **una lista** de mensajes) -> outbox.
- *Pasos*: como admin, crear la plantilla con adjunto por API (`POST /api/templates`
  + `/attachments`); en el hilo, escribir `/`, elegir la plantilla, rellenar las
  variables y enviar.
- *Aserciones*: aparecen tantas burbujas como mensajes devolvió el endpoint, en
  orden; el texto tiene las variables sustituidas; `/__mock/sent` registra el
  texto y el `sendMedia` del adjunto; `POST /api/templates/{id}/use` incrementó
  el contador de uso.
- *Por qué E2E*: criterios 1 y 3. La sustitución de variables vive en
  `utils/templates.ts` y es de Vitest; lo que solo se ve aquí es el encadenado
  atajo -> diálogo -> N mensajes -> N despachos, que es donde se cuelan los
  envíos duplicados.

**11. Reconexión del WebSocket tras corte de red**

- *Flujo*: `context.setOffline(true)` -> el socket cae -> `RECONNECT_DELAY_MS`
  -> reconexión -> el backend manda `notifications_updated` al aceptar
  (`main.py:312`) -> el frontend refetchea.
- *Pasos*: cortar la red; mientras está caída, inyectar dos entrantes por
  webhook; restaurar la red.
- *Aserciones*: durante el corte la UI no muestra los mensajes nuevos (prueba
  de que no hay polling de respaldo); al volver, se abre un socket nuevo, llega
  la trama `notifications_updated` y los dos mensajes aparecen en el hilo y en
  la lista; el contador de no leídos cuadra (no se cuentan dos veces).
- *Por qué E2E*: criterios 1, 2 y 4. Es el escenario que justifica por sí solo
  la existencia de la suite: en un móvil que cambia de wifi a datos esto pasa
  varias veces al día, y su rotura no la ve ningún test unitario porque el
  bug vive en la coordinación entre el `onclose` del navegador y el refetch.
  Corre en modo `serial`: manipula la red del contexto y cuenta reconexiones.

**12. Layout móvil: lista, chat y barra inferior**

- *Flujo*: `useLayout()` = `mobile` -> `App.tsx` oculta la lista al abrir un
  chat, monta `MobileNavBar` y pone las sugerencias en panel deslizable.
- *Pasos*: en `mobile-chrome`, abrir un lead; volver con la flecha; abrir el
  panel de sugerencias; abrir "Más vistas" de la barra inferior; ir a `/kanban`.
- *Aserciones*: con un chat abierto la lista **no** está visible y la barra
  inferior desaparece; "Volver a la lista de chats" la restituye; el panel
  deslizable se abre con "Ver sugerencias del lead" y se cierra con Escape (y
  ese Escape **no** cierra además el chat: el handler de `App.tsx` lo trata en
  dos pasos); el diálogo "Más vistas" navega.
- *Por qué E2E*: criterios 2 y 4. Es el hueco 7 de §1.3: en jsdom `matchMedia`
  siempre devuelve `matches: false`, así que **la rama móvil de `App.tsx` no la
  ejecuta hoy ninguna prueba**. La mitad de los vendedores usa el CRM desde el
  teléfono.

**13. Citar un mensaje y reaccionar con emoji**

- *Flujo*: `QuotedMessage.tsx` + `quoted_wa_message_id`; y
  `POST /api/chats/{chat_id}/messages/{message_id}/reaction` más el webhook
  `/api/webhooks/reaction` para la reacción del cliente.
- *Pasos*: responder a un mensaje del cliente con "Responder a este mensaje";
  enviar; reaccionar a una burbuja propia; disparar una reacción entrante del
  cliente por webhook; disparar una retirada (emoji vacío).
- *Aserciones*: la burbuja nueva muestra la cita con el texto del original;
  `/__mock/sent` incluye el `quoted`; el badge de emoji aparece y desaparece
  sin recargar; una reacción sobre un mensaje inexistente responde
  `{"matched": false}` y no rompe la UI.
- *Por qué E2E*: criterios 1 y 3. La resolución de la cita cruza
  `(chat_id, wa_message_id)` en la base y el badge llega por broadcast: dos
  procesos y un canal en tiempo real.

**14. Publicar un flujo de automatización**

- *Flujo*: `AutomationsPage.tsx` -> `VisualFlowBuilder.tsx` +
  `flow/FlowCanvas.tsx` (`@xyflow/react`) -> `PATCH /api/automations/{id}/flow`
  -> `POST /api/automations/{id}/publish` -> versión en
  `automation_flow_versions`.
- *Pasos*: crear la regla por API; en el lienzo, arrastrar un nodo de acción,
  conectarlo al disparador y publicar; recargar.
- *Aserciones*: el borrador se guarda (aparece el aviso de cambios sin
  publicar, que es justo lo que arregló el commit `668f034`); tras publicar,
  `GET /api/automations/{id}/versions` devuelve una versión nueva y el aviso
  desaparece; tras recargar el lienzo conserva nodos y aristas.
- *Por qué E2E*: criterios 1 y 2. Es el hueco 8 de §1.3. `FlowCanvas.test.ts`
  cubre las funciones puras; arrastrar un nodo y tirar una arista entre dos
  `handles` de `@xyflow/react` necesita punteros reales. Un solo camino feliz,
  como manda §2 — la combinatoria del constructor no sube a E2E.

**15. Webhooks sin token: 401**

- *Flujo*: `verify_webhook_token` (`services/auth_service.py:106-118`) sobre
  `webhooks.router` y `media.router`.
- *Pasos*: llamar a `POST /api/webhooks/messages` y a `POST /api/media/upload`
  sin cabecera, con un token equivocado y con el correcto.
- *Aserciones*: 401 en los dos primeros casos y 200 en el tercero, tanto con
  `Authorization: Bearer` como con `X-Webhook-Token`.
- *Por qué E2E*: criterios 1 y 4. Sin navegador, pero **con la pila real**: es
  la única forma de comprobar que en el entorno desplegado el token está
  configurado y no vacío. Con `INBOUND_WEBHOOK_TOKEN=""` —el valor por defecto
  de `backend/.env.example` y el bug A-1 de `02-bugs.md`— este caso se pone
  rojo, que es exactamente lo que se busca. Si a alguien le incomoda que viva
  en Playwright, su sitio natural es el nivel de integración de API de §2; lo
  que no puede es seguir sin existir.

**16. Mención en nota interna avisa al mencionado**

- *Flujo*: `InternalNoteComposer.tsx` -> `POST /api/chats/{chat_id}/notes` ->
  `notification_created` / `internal_note_mention` por WebSocket -> aviso
  flotante de `App.tsx` ("... te mencionó") y campana de `NotificationCenter`.
- *Pasos*: dos contextos de navegador a la vez (admin y vendedor); el admin
  escribe una nota mencionando al vendedor; el vendedor está en otra vista.
- *Aserciones*: en la página del vendedor aparece el aviso con el nombre del
  autor y el extracto; al pulsarlo navega a `/chat/{lead_id}`; el contador de
  la campana sube; el aviso se retira solo a los 8 s (`setTimeout` de
  `App.tsx`); el aviso **no** aparece dos veces para la misma notificación
  (`surfacedNotificationIdsRef`).
- *Por qué E2E*: criterios 1, 2 y 3. Dos sesiones simultáneas contra el mismo
  backend es algo que solo Playwright puede montar: `manager.broadcast` reparte
  por usuario y esa segmentación no se puede verificar con un solo cliente.

**Descartados a propósito** (para que nadie los añada por costumbre): la
validación de `LeadFormDialog.tsx`, la combinatoria de filtros de `ChatList`,
la paginación por keyset de `GET /api/chats`, el cálculo de la ventana de 24 h,
la generación de sugerencias con IA (dependencia externa cara y no
determinista: se prueba que el CTA dispara la mutación, no la respuesta), y la
actualización del service worker de `PwaUpdatePrompt` salvo un humo mínimo
—que el SW se registre y `navigateFallbackDenylist` no secuestre `/api/`— en
`specs/mobile/pwa.spec.ts`.

## 5. Integración en CI

### 5.1 Dónde encaja en `.github/workflows/ci-cd.yml`

Se añade un quinto job, `e2e-tests`, y se toca **una sola línea** de las
existentes: la lista `needs` de `deploy`.

```
frontend-checks ─┐
backend-checks  ─┼─> e2e-tests ─> deploy
docker-build-check ─────────────┘
```

`e2e-tests` depende de los dos jobs de comprobación rápida a propósito: si el
lint o los tests unitarios están rotos, no tiene sentido gastar cinco minutos
levantando cinco contenedores. `docker-build-check` sigue en paralelo porque
valida otra cosa (la config de nginx en la topología de producción).

### 5.2 La pila: `compose.e2e.yml`

Los servicios se declaran en un compose propio en la raíz, **no** con el bloque
`services:` de GitHub Actions. Razones concretas:

- `services:` no construye imágenes, y aquí hacen falta tres construidas
  (`backend`, `frontend --target prod`, `evolution-mock`).
- Mezclar contenedores de `services:` (publicados en el host) con una red de
  compose obliga a `host.docker.internal` y a duplicar la configuración de red
  entre CI y local.
- Con un compose, **CI y el desarrollador ejecutan exactamente lo mismo**:
  `webServer` de `playwright.config.ts` levanta esta misma pila en local
  (§3.2). Un entorno de E2E que solo existe en CI se pudre en dos semanas.

```yaml
# compose.e2e.yml — pila efímera para la suite de Playwright.
# NO comparte nada con compose.yml (desarrollo, apunta a la base real),
# compose.db.yml (TLS obligatorio, certificados por servidor) ni
# compose.prod.yml (blue-green). Todos sus secretos son literales de prueba.
name: dermicapro-e2e

services:
  postgres:
    # Misma versión mayor y menor que compose.db.yml: probar migraciones
    # contra otra versión de PostgreSQL no prueba las migraciones de producción.
    # Sin ssl=on ni db/pg_hba.conf: aquí no hay certificados que generar.
    image: postgres:16.10-alpine
    environment:
      POSTGRES_DB: e2e
      POSTGRES_USER: e2e
      POSTGRES_PASSWORD: e2e
      POSTGRES_INITDB_ARGS: "--encoding=UTF8"
    # Publicado solo en este compose: las fixtures insertan entrantes y
    # envejecen sent_at desde el host (§3.3). compose.db.yml no lo expone y
    # ese criterio no se toca.
    ports: ["5432:5432"]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U e2e -d e2e"]
      interval: 2s
      timeout: 3s
      retries: 30

  minio:
    image: minio/minio:RELEASE.2025-04-22T22-12-26Z
    command: server /data
    environment:
      MINIO_ROOT_USER: e2eaccess
      MINIO_ROOT_PASSWORD: e2esecret123
    healthcheck:
      test: ["CMD", "mc", "ready", "local"]
      interval: 2s
      timeout: 3s
      retries: 30

  # check_media_storage() de services/media_storage.py hace bucket_exists() y
  # /health/ready devuelve 503 si el bucket no está. Sin este contenedor la
  # pila nunca llega a "healthy" y el fallo no dice por qué.
  minio-init:
    image: minio/mc:RELEASE.2025-04-16T18-13-26Z
    depends_on:
      minio: { condition: service_healthy }
    entrypoint: >
      sh -c "mc alias set e2e http://minio:9000 e2eaccess e2esecret123 &&
             mc mb --ignore-existing e2e/dermicapro-e2e"

  evolution-mock:
    build: ./e2e/mocks/evolution
    # 8081 en el host: la fixture `evolution` consulta /__mock/sent desde fuera.
    ports: ["8081:8080"]
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:8080/__mock/health"]
      interval: 2s
      timeout: 3s
      retries: 15

  # El esquema NO lo crea la aplicación: main.py aborta con
  # SchemaNotMigratedError si alembic_version no coincide con el head. Es el
  # mismo comando que ejecuta scripts/deploy-bluegreen.sh en producción, así
  # que cada run de E2E prueba también las migraciones sobre una base virgen.
  migrate:
    build: ./backend
    command: python -m scripts.migrate
    depends_on:
      postgres: { condition: service_healthy }
    environment: &backend_env
      DATABASE_URL: postgresql+asyncpg://e2e:e2e@postgres/e2e
      DATABASE_SSL: disable
      SECRET_KEY: e2e-secret-key-not-a-real-one
      ADMIN_EMAIL: admin@e2e.local
      ADMIN_PASSWORD: e2e-admin-pass
      INBOUND_WEBHOOK_TOKEN: e2e-inbound-token
      # Sin esto, _config() de evolution_service usaría el valor de
      # app_settings si alguien restaurase un dump: ver §3.5.
      EVOLUTION_API_URL: http://evolution-mock:8080
      EVOLUTION_API_KEY: e2e-key
      EVOLUTION_INSTANCE: e2e-instance
      N8N_WEBHOOK_URL: http://evolution-mock:8080/__mock/n8n
      MEDIA_STORAGE_BACKEND: minio
      MINIO_ENDPOINT: minio:9000
      MINIO_ACCESS_KEY: e2eaccess
      MINIO_SECRET_KEY: e2esecret123
      MINIO_BUCKET: dermicapro-e2e
      MINIO_SECURE: "false"
      # La cookie no puede salir Secure: el navegador de Playwright entra por
      # http://localhost:8080 y una cookie Secure sobre http se descarta.
      COOKIE_SECURE: "false"

  backend:
    build: ./backend
    environment: *backend_env
    depends_on:
      migrate: { condition: service_completed_successfully }
      minio-init: { condition: service_completed_successfully }
      evolution-mock: { condition: service_healthy }
    ports: ["8000:8000"]   # solo para el sondeo de /health/ready
    healthcheck:
      test: ["CMD", "python", "-c", "import urllib.request; urllib.request.urlopen('http://localhost:8000/health/ready', timeout=3)"]
      interval: 3s
      timeout: 5s
      retries: 30
      start_period: 20s

  frontend:
    build:
      context: ./frontend
      target: prod
      args:
        # Vacío = axios con baseURL relativa y WebSocket relativo: todo pasa
        # por nginx y queda mismo origen, igual que en producción (§3.2).
        VITE_API_BASE_URL: ""
    depends_on:
      backend: { condition: service_healthy }
    ports: ["8080:80"]
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost/index.html"]
      interval: 2s
      timeout: 3s
      retries: 20
```

### 5.3 El job

```yaml
  e2e-tests:
    needs: [frontend-checks, backend-checks]
    # No en cada push de cada rama: son ~6 minutos de runner. En PR contra main
    # y en main. Para forzarlo en una rama, la etiqueta run-e2e en el PR.
    if: github.event_name == 'pull_request' || github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    timeout-minutes: 25
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: npm
          cache-dependency-path: e2e/package-lock.json

      - run: npm ci
        working-directory: e2e

      # El binario de Chromium pesa ~170 MB; sin caché son 40-60 s por run.
      # La clave lleva la versión de @playwright/test: una actualización menor
      # del paquete exige un navegador distinto y una caché vieja lo rompe.
      - name: Cache de navegadores
        id: playwright-cache
        uses: actions/cache@v4
        with:
          path: ~/.cache/ms-playwright
          key: playwright-${{ runner.os }}-${{ hashFiles('e2e/package-lock.json') }}

      # Solo chromium: los tres proyectos (chromium, chromium-vendedor,
      # mobile-chrome con devices['Pixel 7']) usan el mismo motor. WebKit y
      # Firefox se instalan únicamente en el workflow nocturno.
      - name: Instalar navegador
        working-directory: e2e
        run: npx playwright install --with-deps chromium

      - uses: docker/setup-buildx-action@v3

      - name: Levantar la pila
        run: docker compose -f compose.e2e.yml up -d --wait --wait-timeout 180

      # PLAYWRIGHT_HTML_OPEN=never evita que el reporter intente abrir un
      # navegador en un runner sin escritorio y deje el job colgado.
      # --fail-on-flaky-tests: un test que pasa al reintentar es un test roto;
      # se activa al terminar la fase 3 de §6, no antes.
      - name: Playwright
        working-directory: e2e
        env:
          CI: "true"
          PLAYWRIGHT_HTML_OPEN: never
          E2E_BASE_URL: http://localhost:8080
          E2E_API_URL: http://localhost:8000
          E2E_DB_URL: postgresql://e2e:e2e@localhost:5432/e2e
          E2E_EVOLUTION_MOCK_URL: http://localhost:8081
          E2E_ADMIN_EMAIL: admin@e2e.local
          E2E_ADMIN_PASSWORD: e2e-admin-pass
          E2E_INBOUND_WEBHOOK_TOKEN: e2e-inbound-token
        run: npx playwright test --fail-on-flaky-tests

      # Un fallo de E2E casi nunca se explica solo con la traza del navegador:
      # la mitad de las veces está en el log del backend o del worker del outbox.
      - name: Logs de la pila
        if: failure()
        run: docker compose -f compose.e2e.yml logs --no-color > e2e/artifacts-logs.txt

      - name: Subir informe y trazas
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-report-${{ github.run_attempt }}
          path: |
            e2e/playwright-report/
            e2e/test-results/
            e2e/artifacts-logs.txt
          retention-days: 7
          if-no-files-found: ignore

      - name: Tirar la pila
        if: always()
        run: docker compose -f compose.e2e.yml down -v
```

Notas que ahorran una tarde de depuración:

- **`E2E_DB_URL` apunta a `localhost:5432`**, así que `postgres` tiene que
  publicar el puerto en `compose.e2e.yml` cuando la suite corra desde el host
  (el caso de CI y el de desarrollo). Se publica solo en este compose; el de
  producción no expone 5432 a propósito, y ese criterio no se toca.
- **No hace falta ningún `secret` del repositorio.** Todos los valores son
  literales de prueba, lo que permite que el job corra en PRs desde forks y
  que un desarrollador reproduzca el entorno exacto sin pedir credenciales.
- **La caché de Docker.** Con `setup-buildx-action` y `cache-from: type=gha` en
  las dos imágenes construidas, el build baja de ~3 min a ~40 s cuando no han
  cambiado `requirements.txt` ni `package-lock.json`.
- **Concurrencia.** Conviene añadir al workflow
  `concurrency: { group: ci-${{ github.ref }}, cancel-in-progress: true }`
  para no acumular runs de E2E en una rama con varios pushes seguidos.

### 5.4 Qué bloquea el merge

| Estado | Regla |
|---|---|
| Fases 1-2 de §6 | `e2e-tests` corre con `continue-on-error: true`. Informa, no bloquea. Sirve para medir estabilidad real antes de darle poder de veto. |
| Desde la fase 3 | `e2e-tests` pasa a obligatorio en la protección de rama de `main` (junto a `frontend-checks`, `backend-checks` y `docker-build-check`) y entra en `needs` de `deploy`. |
| Siempre | Un test marcado `test.fixme` o `test.skip` **no** bloquea, pero el informe HTML lo lista; más de tres saltados abiertos en `main` es deuda que se revisa en la retro. |
| Siempre | `--fail-on-flaky-tests` desde la fase 3: un caso que solo pasa al reintentar rompe el job. Es la única forma de que la suite no se degrade hasta que nadie mire su resultado. |

El cambio en `deploy` es literalmente una línea:

```yaml
  deploy:
    needs: [frontend-checks, backend-checks, docker-build-check, e2e-tests]
```

Es el punto del plan que más valor aporta: hoy el gate de despliegue a
producción se apoya, según el propio comentario de `ci-cd.yml`, en pruebas que
"usan dobles" y nunca tocan PostgreSQL. A partir de aquí, para llegar al VPS
hay que haber demostrado que un mensaje sale, otro entra y la sesión funciona
en un navegador de verdad.

**Workflow nocturno aparte** (`.github/workflows/e2e-nightly.yml`, `schedule`
a las 03:00): la suite entera más los proyectos `webkit` y `firefox`, más
`@storybook/addon-a11y` en modo CI si se adopta el nivel de contrato de UI de
§2. Los fallos avisan por el canal del equipo, no bloquean nada.

## 6. Plan de adopción por fases

El esfuerzo va en **jornadas-persona (j-p)** de una persona que ya conoce el
repositorio. Total: **28-31 j-p**, unas siete semanas a media dedicación. El
orden no es negociable: cada fase paga la siguiente, y la fase 0 es la que
evita que la suite nazca lenta y frágil.

### Fase 0 — Andamiaje (3-4 j-p)

- Crear `e2e/` con su `package.json`, `tsconfig.json` y `playwright.config.ts`
  (§7.1); añadir `e2e/.auth/`, `e2e/playwright-report/` y `e2e/test-results/`
  a `.gitignore`.
- `compose.e2e.yml` (§5.2) y el mock de Evolution (`e2e/mocks/evolution/`),
  con las ocho rutas que consume `backend/services/evolution_service.py` y la
  superficie `/__mock/*`.
- Fixtures `db`, `api`, `webhooks`, `evolution`, `lead`, `realtime`
  (`e2e/fixtures/test.ts`) y el proyecto `setup` con `auth.setup.ts` (§7.2).
- Un único spec de humo: login, la lista carga, el WebSocket conecta.
- Job `e2e-tests` en CI con `continue-on-error: true`.

*Criterios de salida*: `npx playwright test` verde en local partiendo de
`docker compose down -v`; la pila alcanza el estado `healthy` en menos de 90 s;
el informe HTML se sube como artefacto; el README documenta el comando de
arranque. **Si la pila no arranca de cero de forma repetible, no se pasa de
fase**: todo lo demás se construye encima de eso.

### Fase 1 — Los seis P0 (7-8 j-p)

Escenarios 1 a 6 de §4: sesión, envío, recepción, estados de mensaje, reintento
y guardas de rol. Page Objects `LoginPo`, `AppShellPo`, `ChatListPo`,
`ChatThreadPo`. Segundo `storageState` para el vendedor.

*Criterios de salida*: los seis specs verdes en **diez ejecuciones seguidas** en
CI (se mide con `gh run rerun`, no a ojo); cero apariciones de
`page.waitForTimeout` en `e2e/` con la regla de lint activa; el job completo
—incluido levantar la pila— por debajo de 8 minutos; cada spec identifica en su
cabecera el hueco de §1.3 que cubre.

*Riesgo principal*: el escenario 2 depende del worker del outbox
(`IDLE_POLL_SECONDS = 1.0`). Si resulta inestable, la solución **no** es subir
timeouts a ciegas sino instrumentar: comprobar primero con `expect.poll` contra
`/__mock/sent` que el backend despachó, y solo después afirmar sobre el DOM.
Así un fallo distingue "no despachó" de "despachó y la UI no se enteró".

### Fase 2 — Los seis P1 y el proyecto móvil (9-10 j-p)

Escenarios 7 a 12: Kanban, multimedia con MinIO, ventana de 24 h, plantillas,
reconexión y layout móvil.

Requiere un **PR previo y mínimo (0.5 j-p) en `frontend/src/components`**: hoy
no hay ningún `data-testid` en producción (§3.7). Hacen falta exactamente dos:
uno en la columna de `KanbanBoard.tsx` (`data-testid="kanban-column-<stage>"`,
que no tiene rol ni etiqueta accesible) y otro en la burbuja de
`MessageBubble.tsx` (`data-testid="message-<id>"`, para poder afirmar sobre un
mensaje concreto sin depender de su texto). Nada más: el resto de anclajes ya
existen y están inventariados en la tabla de §3.7.

*Criterios de salida*: doce specs en verde; tasa de inestabilidad por debajo del
2 % medida sobre veinte ejecuciones nocturnas; el proyecto `mobile-chrome`
ejercita la rama `isMobile` de `App.tsx` (comprobado porque su spec falla al
forzar `layout = 'desktop'`); el job por debajo de 12 minutos con 2 workers.

### Fase 3 — Blindaje y puerta de despliegue (2-3 j-p)

- Quitar `continue-on-error`, añadir `--fail-on-flaky-tests`, meter
  `e2e-tests` en `needs` de `deploy` y en la protección de rama de `main`.
- Workflow nocturno con `webkit` y `firefox`.
- Runbook de depuración en `docs/`: cómo abrir una traza descargada del
  artefacto, cómo levantar la pila en local y correr un solo spec con
  `--headed --debug`, y dónde mirar en `artifacts-logs.txt`.

*Criterios de salida*: un PR con un fallo introducido a propósito (por ejemplo,
romper el `delete_cookie` de `routers/auth.py`) queda bloqueado por
`e2e-tests`; el equipo sabe leer una traza sin ayuda; ninguna alerta nocturna
lleva más de una semana sin triaje.

### Fase 4 — Ampliación (7-8 j-p, continua)

Escenarios 13 a 16 (P2), y sobre todo **el nivel de integración de API de §2**,
que es el más rentable de la pirámide y hoy no existe: 40-60 casos con
`httpx.ASGITransport` contra el mismo PostgreSQL efímero de `compose.e2e.yml`,
cubriendo paginación por keyset y búsqueda con `unaccent` de `GET /api/chats`,
`PATCH /stage`, todos los `POST /api/webhooks/*` y `require_admin`. Se ejecuta
dentro de `backend-checks` (con el servicio de Postgres) y baja presión sobre
la punta E2E. En paralelo, las ~30 stories de Storybook que §2 propone y que
hoy están pagadas y sin usar.

*Criterios de salida*: ningún escenario nuevo entra en E2E sin comprobar antes
que no encaja en el nivel de integración de API; la suite E2E se mantiene entre
15 y 20 specs. Que la punta no crezca es un criterio de éxito, no un límite.

### Resumen

| Fase | Alcance | Esfuerzo | Bloquea el merge |
|---|---|---|---|
| 0 | Andamiaje, pila, mock, fixtures, 1 humo | 3-4 j-p | No |
| 1 | Escenarios 1-6 (P0) | 7-8 j-p | No |
| 2 | Escenarios 7-12 (P1) + móvil + PR de `data-testid` | 9-10 j-p | No |
| 3 | Gate de despliegue, nocturno, runbook | 2-3 j-p | **Sí** |
| 4 | Escenarios 13-16 + integración de API + Storybook | 7-8 j-p | Sí (los que ya estén) |

**Señales de que el plan se está torciendo**, para revisarlas en cada fase: la
suite pasa de 20 specs; alguien añade un `waitForTimeout` "solo por esta vez";
un spec monta su estado a base de clics en vez de por API; el job supera los
15 minutos; o aparece el primer `test.skip` que nadie reclama. Cualquiera de
las cinco es el principio del final de una suite E2E.

## 7. Ejemplos de código

Todo lo que sigue está escrito contra este repositorio: los selectores salen de
los `aria-label`, `placeholder` y etiquetas que existen hoy en
`frontend/src/components`, y los endpoints de `backend/routers/`. Es código para
copiar, no pseudocódigo.

### 7.1 `e2e/playwright.config.ts`

```ts
import { defineConfig, devices } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = path.dirname(fileURLToPath(import.meta.url))

// nginx (imagen frontend --target prod) delante del backend: mismo origen,
// igual que en producción. Ver §3.2.
const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:8080'
// nginx solo proxea /api/, /media/ y /ws/ (frontend/nginx.conf): el sondeo de
// arranque tiene que ir directo al backend, porque /health no pasa por nginx.
const API_URL = process.env.E2E_API_URL ?? 'http://localhost:8000'

export const ADMIN_STATE = path.join(rootDir, '.auth/admin.json')
export const VENDEDOR_STATE = path.join(rootDir, '.auth/vendedor.json')

export default defineConfig({
  outputDir: './test-results',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // Comparten una sola base; el aislamiento es por namespacing de lead (§3.3),
  // no por serializar. Más de 2 no compensa: el cuello es el backend.
  workers: process.env.CI ? 2 : undefined,
  // 45 s y no 30: el worker del outbox (services/message_outbox.py) tiene
  // IDLE_POLL_SECONDS = 1.0 y hay specs que encadenan envío + estado + eco.
  timeout: 45_000,
  expect: { timeout: 10_000 },

  reporter: process.env.CI
    ? [
        ['html', { outputFolder: 'playwright-report', open: 'never' }],
        ['github'],
        ['junit', { outputFile: 'test-results/junit.xml' }],
      ]
    : [['html', { outputFolder: 'playwright-report', open: 'never' }], ['list']],

  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 10_000,
    navigationTimeout: 20_000,
    // La UI está en español rioplatense y los timestamps se formatean con
    // toLocaleTimeString('es-AR') en ChatItem.tsx: fijar locale y zona evita
    // que la suite dependa de la configuración del runner.
    locale: 'es-AR',
    timezoneId: 'America/Lima',
  },

  projects: [
    {
      name: 'setup',
      testDir: './setup',
      testMatch: /.*\.setup\.ts/,
      use: { ...devices['Desktop Chrome'], baseURL: BASE_URL },
    },
    {
      name: 'chromium',
      testDir: './specs',
      // roles.spec.ts necesita la sesión de vendedor; mobile/ va en su proyecto.
      testIgnore: ['mobile/**', '**/roles.spec.ts'],
      dependencies: ['setup'],
      use: {
        ...devices['Desktop Chrome'],
        // 1440x900 -> useLayout() devuelve 'desktop': tres columnas con
        // SuggestionPanel fijo (App.tsx).
        viewport: { width: 1440, height: 900 },
        storageState: ADMIN_STATE,
      },
    },
    {
      name: 'chromium-vendedor',
      testDir: './specs',
      testMatch: '**/roles.spec.ts',
      dependencies: ['setup'],
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        storageState: VENDEDOR_STATE,
      },
    },
    {
      name: 'mobile-chrome',
      testDir: './specs/mobile',
      dependencies: ['setup'],
      // Pixel 7 es Chromium: no añade un motor más al tiempo de CI, pero sí
      // matchMedia real, que es lo que hoy no ejecuta nadie (hueco 7 de §1.3).
      use: { ...devices['Pixel 7'], storageState: ADMIN_STATE },
    },
  ],

  webServer: {
    command: 'docker compose -f ../compose.e2e.yml up -d --wait --wait-timeout 180',
    url: `${API_URL}/health/ready`,
    // true también en CI, a propósito: allí el job ya levantó la pila y con
    // `false` Playwright aborta con "port is already used" en vez de usarla.
    reuseExistingServer: true,
    timeout: 240_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
})
```

### 7.2 Fixture de autenticación

Dos piezas: el proyecto `setup`, que hace login por la UI y vuelca el
`storageState`, y el `test` extendido que reparte contextos y Page Objects.

**`e2e/setup/auth.setup.ts`**

```ts
import { test as setup, expect, request } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { ADMIN_STATE, VENDEDOR_STATE } from '../playwright.config'
import { LoginPo } from '../pages/LoginPo'

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? 'admin@e2e.local'
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'e2e-admin-pass'
export const VENDEDOR_EMAIL = 'vendedor@e2e.local'
export const VENDEDOR_PASSWORD = 'e2e-vendedor-pass'

// El vendedor se crea con la sesión de admin, así que el orden importa.
setup.describe.configure({ mode: 'serial' })

setup('sesión de admin', async ({ page, context }) => {
  fs.mkdirSync(path.dirname(ADMIN_STATE), { recursive: true })

  // Login por la UI y no por POST /api/auth/login: cuesta dos segundos una
  // vez por run y a cambio cubre lo que ninguna otra capa ve — que la cookie
  // httponly que emite backend/routers/auth.py, pasando por nginx, la acepte
  // un navegador de verdad.
  await page.goto('/')
  await new LoginPo(page).entrar(ADMIN_EMAIL, ADMIN_PASSWORD)
  await expect(page.getByRole('navigation', { name: 'Vista principal' })).toBeVisible()

  // El admin del arranque lo siembra seed_admin_if_needed() desde el lifespan
  // de main.py con ADMIN_EMAIL/ADMIN_PASSWORD; si esto falla, la pila levantó
  // sobre una base que no estaba vacía.
  await context.storageState({ path: ADMIN_STATE })
})

setup('sesión de vendedor', async ({ page, context }) => {
  const admin = await request.newContext({
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:8080',
    storageState: ADMIN_STATE,
  })
  // POST /api/users está bajo require_admin (backend/routers/users.py:15).
  // 409 = ya existe de un run anterior contra la misma base; es correcto seguir.
  const created = await admin.post('/api/users', {
    data: {
      email: VENDEDOR_EMAIL,
      name: 'Vendedor E2E',
      password: VENDEDOR_PASSWORD,
      role: 'vendedor',
    },
  })
  expect([201, 409]).toContain(created.status())
  await admin.dispose()

  await page.goto('/')
  await new LoginPo(page).entrar(VENDEDOR_EMAIL, VENDEDOR_PASSWORD)
  await expect(page.getByRole('navigation', { name: 'Vista principal' })).toBeVisible()
  // Comprobación de que el rol es el que se pidió: si el backend devolviera
  // admin, roles.spec.ts pasaría por el motivo equivocado.
  await expect(page.getByLabel('Configuración')).toHaveCount(0)

  await context.storageState({ path: VENDEDOR_STATE })
})
```

**`e2e/pages/LoginPo.ts`**

```ts
import type { Page } from '@playwright/test'

// Selectores tomados de frontend/src/components/LoginPage.tsx: los <label>
// llevan htmlFor="login-email" / "login-password" y el submit dice "Entrar".
export class LoginPo {
  constructor(private readonly page: Page) {}

  readonly email = () => this.page.getByLabel('Email')
  readonly password = () => this.page.getByLabel('Contraseña')
  readonly submit = () => this.page.getByRole('button', { name: 'Entrar' })
  readonly error = () => this.page.getByText('Email o contraseña incorrectos')

  async entrar(email: string, password: string): Promise<void> {
    await this.email().fill(email)
    await this.password().fill(password)
    await this.submit().click()
  }
}
```

**`e2e/fixtures/test.ts`** (extracto: lo relacionado con sesión, webhooks,
tiempo real y leads; el resto de Page Objects se registra igual)

```ts
import { test as base, expect, type APIRequestContext, type Page, type WebSocket } from '@playwright/test'
import { Client } from 'pg'
import { randomUUID } from 'node:crypto'
import { ChatListPo } from '../pages/ChatListPo'
import { ChatThreadPo } from '../pages/ChatThreadPo'

const API = process.env.E2E_BASE_URL ?? 'http://localhost:8080'
const DB_URL = process.env.E2E_DB_URL ?? 'postgresql://e2e:e2e@localhost:5432/e2e'
const MOCK = process.env.E2E_EVOLUTION_MOCK_URL ?? 'http://localhost:8081'
const WEBHOOK_TOKEN = process.env.E2E_INBOUND_WEBHOOK_TOKEN ?? 'e2e-inbound-token'
const INSTANCE = 'e2e-instance'

export interface Lead {
  chatId: string      // leads.id (UUID); es el chat_id de toda la API
  jid: string         // 519...@s.whatsapp.net
  phone: string
  tag: string         // nombre único por worker: se busca por él en ChatList
}

interface Realtime {
  waitForFrame(match: (event: Record<string, unknown>) => boolean): Promise<void>
}

export const test = base.extend<{
  api: APIRequestContext
  db: Client
  lead: Lead
  webhooks: {
    inbound(lead: Lead, text: string, opts?: { sentAt?: string }): Promise<string>
    messageStatus(waMessageId: string, status: string, fromMe?: boolean): Promise<void>
  }
  evolution: { sent(): Promise<unknown[]>; reset(): Promise<void>; failNext(): Promise<void> }
  realtime: Realtime
  chatList: ChatListPo
  chatThread: ChatThreadPo
}>({
  api: async ({ playwright }, use) => {
    // Hereda el storageState del proyecto activo: el mismo rol que el navegador.
    const ctx = await playwright.request.newContext({ baseURL: API, storageState: test.info().project.use.storageState })
    await use(ctx)
    await ctx.dispose()
  },

  db: [async ({}, use) => {
    const client = new Client({ connectionString: DB_URL })
    await client.connect()
    await use(client)
    await client.end()
  }, { scope: 'worker' }],

  lead: async ({ api }, use) => {
    // Namespacing por worker (§3.3): sin esto dos workers se pisan la lista.
    const tag = `E2E-W${test.info().parallelIndex}-${randomUUID().slice(0, 8)}`
    const phone = `51900${String(Date.now()).slice(-6)}`
    const jid = `${phone}@s.whatsapp.net`

    // Mismo camino que n8n antes de escribir un mensaje: el webhook devuelve
    // el chat_id canónico y deja la fila en whatsapp_identities.
    const res = await api.post('/api/webhooks/resolve-whatsapp-identity', {
      headers: { Authorization: `Bearer ${WEBHOOK_TOKEN}` },
      data: { instance: INSTANCE, data: { key: { remoteJid: jid, fromMe: false }, pushName: tag } },
    })
    expect(res.status(), await res.text()).toBe(200)
    const { chat_id: chatId } = await res.json()

    await use({ chatId, jid, phone, tag })
    // Sin borrado: no existe endpoint para eliminar leads y no se inventa uno
    // para los tests. La base es efímera; el aislamiento lo da el tag.
  },

  webhooks: async ({ api, db }, use) => {
    await use({
      // n8n INSERTA el entrante en wsp_messages y DESPUÉS llama al webhook.
      // Se reproduce igual: no hay endpoint de inserción de entrantes.
      async inbound(lead, text, opts) {
        const waId = `WA-IN-${randomUUID()}`
        await db.query(
          `INSERT INTO wsp_messages (chat_id, sender, content, sent_at, wa_message_id, message_type)
           VALUES ($1, 'cliente', $2, COALESCE($3::timestamptz, now()), $4, 'text')`,
          [lead.chatId, text, opts?.sentAt ?? null, waId],
        )
        const res = await api.post('/api/webhooks/messages', {
          headers: { Authorization: `Bearer ${WEBHOOK_TOKEN}` },
          data: { wa_message_id: waId },
        })
        expect(res.status()).toBe(200)
        return waId
      },
      async messageStatus(waMessageId, status, fromMe = true) {
        const res = await api.post('/api/webhooks/message-status', {
          headers: { Authorization: `Bearer ${WEBHOOK_TOKEN}` },
          data: { wa_message_id: waMessageId, status, from_me: fromMe },
        })
        expect(res.status()).toBe(200)
      },
    })
  },

  evolution: async ({ playwright }, use) => {
    const ctx = await playwright.request.newContext({ baseURL: MOCK })
    await ctx.post('/__mock/reset')
    await use({
      sent: async () => (await (await ctx.get('/__mock/sent')).json()) as unknown[],
      reset: async () => void (await ctx.post('/__mock/reset')),
      failNext: async () => void (await ctx.post('/__mock/fail-next')),
    })
    await ctx.dispose()
  },

  realtime: async ({ page }, use) => {
    // Se engancha ANTES del primer goto: useChatUpdates conecta en el primer
    // render y un listener tardío se pierde la conexión.
    const sockets: WebSocket[] = []
    page.on('websocket', ws => sockets.push(ws))

    await use({
      async waitForFrame(match) {
        // La promesa se crea antes de disparar el webhook (§3.6), si no hay carrera.
        const ws = sockets[0] ?? (await page.waitForEvent('websocket'))
        await ws.waitForEvent('framereceived', frame => {
          try {
            return match(JSON.parse(frame.payload as string))
          } catch {
            return false
          }
        })
      },
    })
  },

  chatList: async ({ page }, use) => { await use(new ChatListPo(page)) },
  chatThread: async ({ page }, use) => { await use(new ChatThreadPo(page)) },
})

export { expect }
```

**Los dos Page Objects que usan los specs de abajo**

```ts
// e2e/pages/ChatListPo.ts — frontend/src/components/ChatList.tsx + ChatItem.tsx
import type { Page } from '@playwright/test'

export class ChatListPo {
  constructor(private readonly page: Page) {}

  readonly buscador = () => this.page.getByPlaceholder('Buscar lead...')

  // ChatItem.tsx renderiza cada chat como <button type="button">, sin rol ni
  // testid propios: se localiza por el nombre del lead, que es el tag único.
  item = (tag: string) => this.page.getByRole('button').filter({ hasText: tag })

  async buscar(tag: string): Promise<void> {
    // El input está debounced 300 ms en App.tsx; no hace falta esperar: la
    // aserción posterior reintenta sola.
    await this.buscador().fill(tag)
  }

  async abrir(tag: string): Promise<void> {
    await this.buscar(tag)
    await this.item(tag).click()
  }
}
```

```ts
// e2e/pages/ChatThreadPo.ts — ChatThread.tsx + ChatComposer.tsx + MessageBubble.tsx
import type { Page } from '@playwright/test'

export class ChatThreadPo {
  constructor(private readonly page: Page) {}

  readonly composer = () =>
    this.page.getByPlaceholder('Escribí un mensaje... (/ para usar una plantilla)')
  readonly enviar = () => this.page.getByLabel('Enviar mensaje')
  readonly volver = () => this.page.getByLabel('Volver a la lista de chats')

  burbuja = (texto: string) => this.page.getByText(texto, { exact: false })

  // Indicadores de MessageBubble.tsx: "Enviando", "Enviado", "Entregado",
  // "Leído" y el botón "No se pudo confirmar el envío. Reintentar".
  estado = (nombre: string) => this.page.getByLabel(nombre)

  async enviarTexto(texto: string): Promise<void> {
    await this.composer().fill(texto)
    await this.enviar().click()
  }
}
```

### 7.3 Spec completo: sesión (escenario 1)

```ts
// e2e/specs/auth/sesion.spec.ts
import { test, expect } from '../../fixtures/test'
import { LoginPo } from '../../pages/LoginPo'

const EMAIL = process.env.E2E_ADMIN_EMAIL ?? 'admin@e2e.local'
const PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'e2e-admin-pass'

// El único spec que NO hereda el storageState del proyecto: prueba el login.
test.use({ storageState: { cookies: [], origins: [] } })

test.describe('sesión', () => {
  test('rechaza credenciales incorrectas sin dejar cookie', async ({ page, context }) => {
    await page.goto('/')
    const login = new LoginPo(page)

    await login.entrar(EMAIL, 'contraseña-que-no-es')

    await expect(login.error()).toBeVisible()
    const cookies = await context.cookies()
    expect(cookies.find(c => c.name === 'access_token')).toBeUndefined()
  })

  test('entra, sobrevive a una recarga y cierra sesión de verdad', async ({ page, context }) => {
    await page.goto('/')
    await new LoginPo(page).entrar(EMAIL, PASSWORD)

    // AuthGate resuelve GET /api/auth/me y monta MainLayout.
    await expect(page.getByRole('navigation', { name: 'Vista principal' })).toBeVisible()

    // La cookie la emite backend/routers/auth.py y llega a través de nginx.
    // Se comprueban los atributos, no solo su existencia: `secure` sale de
    // _cookie_is_secure() leyendo X-Forwarded-Proto, y sobre http tiene que
    // valer false o el navegador la descarta sin decir nada.
    const sesion = (await context.cookies()).find(c => c.name === 'access_token')
    expect(sesion).toBeDefined()
    expect(sesion).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/', secure: false })

    await page.reload()
    await expect(page.getByRole('navigation', { name: 'Vista principal' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Entrar' })).toHaveCount(0)

    await page.getByLabel('Cerrar sesión').click()
    await expect(page.getByRole('button', { name: 'Entrar' })).toBeVisible()

    // La aserción que justifica todo el escenario: delete_cookie solo borra si
    // sus atributos coinciden con los del set_cookie original. Si no coinciden,
    // la UI muestra el login igual (React limpia su caché con el 401) pero la
    // cookie sigue viva en el navegador. Solo se ve mirándola.
    expect((await context.cookies()).find(c => c.name === 'access_token')).toBeUndefined()
  })

  test('sin sesión, /api/auth/me responde 401', async ({ playwright }) => {
    const anonimo = await playwright.request.newContext({
      baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:8080',
      storageState: { cookies: [], origins: [] },
    })
    expect((await anonimo.get('/api/auth/me')).status()).toBe(401)
    await anonimo.dispose()
  })
})
```

### 7.4 Spec completo: mensaje entrante por WebSocket (escenario 3)

```ts
// e2e/specs/chat/recibir-mensaje.spec.ts
import { test, expect } from '../../fixtures/test'

test.describe('mensaje entrante', () => {
  test('con el hilo abierto, la burbuja aparece sin recargar', async ({
    page, chatList, chatThread, webhooks, realtime, lead,
  }) => {
    await page.goto('/')
    await chatList.abrir(lead.tag)
    await expect(chatThread.composer()).toBeVisible()

    const texto = `Hola, quiero información (${lead.tag})`

    // La promesa se crea ANTES de disparar el webhook: el broadcast de
    // services/ws_manager.py es inmediato y con el orden invertido se pierde
    // la trama y el test se cuelga hasta el timeout (§3.6).
    const trama = realtime.waitForFrame(
      e => e.type === 'chats_updated' && e.chat_id === lead.chatId && e.reason === 'inbound_message',
    )
    await webhooks.inbound(lead, texto)
    await trama

    await expect(chatThread.burbuja(texto)).toBeVisible()

    // Ninguna recarga de por medio: mientras el socket está conectado
    // useChats desactiva el refetchInterval, así que si esto se ve, se vio
    // por el WebSocket y no por polling.
    expect(page.url()).toContain(`/chat/${lead.chatId}`)
  })

  test('con el hilo cerrado, la lista sube el chat y marca el no leído', async ({
    page, chatList, webhooks, realtime, lead,
  }) => {
    await page.goto('/')
    await chatList.buscar(lead.tag)
    await expect(chatList.item(lead.tag)).toBeVisible()

    const texto = `Necesito precio de láser (${lead.tag})`
    const trama = realtime.waitForFrame(
      e => e.type === 'chats_updated' && e.chat_id === lead.chatId,
    )
    await webhooks.inbound(lead, texto)
    await trama

    const item = chatList.item(lead.tag)
    await expect(item).toContainText(texto)
    // El globo de no leídos de ChatItem.tsx; se afirma dentro del item del
    // lead y nunca sobre el contador global de la barra, que es compartido
    // entre workers (§3.3).
    await expect(item).toContainText('1')
  })

  test('un entrante antiguo no adelanta el chat ni inventa no leídos', async ({
    page, chatList, webhooks, lead,
  }) => {
    // Regresión barata sobre el orden por keyset (sent_at DESC, id DESC) de
    // idx_wsp_messages_chat_cursor: un mensaje viejo no debe reordenar nada.
    await webhooks.inbound(lead, `Mensaje viejo (${lead.tag})`, {
      sentAt: new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString(),
    })

    await page.goto('/')
    await chatList.buscar(lead.tag)
    await expect(chatList.item(lead.tag)).toContainText('Mensaje viejo')
  })
})
```

Detalles que hacen que estos specs sean estables y no "verdes por casualidad":

- El estado se monta por API y por SQL (fixtures `lead` y `webhooks`), nunca a
  base de clics. El spec solo hace lo que haría el usuario.
- Cada aserción está acotada al `tag` del lead del worker: ningún
  `.first()`, ningún contador global.
- No hay un solo `waitForTimeout`. Las esperas son la trama del WebSocket y
  las aserciones web-first, que reintentan solas.
- Los selectores son los que ya existen en el código de producción; el único
  añadido que este plan pide al frontend son dos `data-testid` (§6, fase 2).

## Apéndice: guía de migración desde Cypress

Recordatorio del aviso previo: **en este repositorio no hay Cypress**. Este
apéndice existe solo por si aparece una suite fuera del repositorio que haya que
traer. Si no la hay, se ignora y se sigue el plan de §6 tal cual.

### A.1 Equivalencias directas

| Cypress | Playwright | Nota |
|---|---|---|
| `cy.visit('/')` | `await page.goto('/')` | `baseURL` sale de `use.baseURL`, no de `cypress.config.js`. |
| `cy.get('.chat-item')` | `page.locator('.chat-item')` | Migrar a `getByRole`/`getByLabel` en el mismo movimiento: en este repo hay buenos `aria-label` (§3.7) y no hay `data-testid`. |
| `cy.contains('Entrar')` | `page.getByText('Entrar')` / `getByRole('button', { name: 'Entrar' })` | |
| `.should('be.visible')` | `await expect(locator).toBeVisible()` | El `await` no es opcional: sin él la aserción no se ejecuta y el test pasa siempre. Es el error número uno de la migración. |
| `.should('have.length', 3)` | `await expect(locator).toHaveCount(3)` | |
| `cy.intercept('GET', '/api/chats')` | `await page.route('**/api/chats*', ...)` | Solo sirve para peticiones **del navegador** (ver A.2). |
| `cy.wait('@alias')` | `await page.waitForResponse(r => r.url().includes('/api/chats'))` | |
| `cy.request(...)` | `await request.post(...)` con el fixture `api` | |
| `cy.session(...)` | `storageState` + proyecto `setup` (§7.2) | Playwright lo persiste en disco y se comparte entre proyectos. |
| `Cypress.Commands.add(...)` | Fixtures de `test.extend` (§7.2) | Tipadas, con `await` y con teardown; no hay cadena implícita. |
| `cy.task('db:query', ...)` | Fixture `db` con el cliente `pg` directamente | Los specs corren en Node, no en el navegador: no hace falta puente. |
| `cypress/fixtures/*.json` | Datos creados por API en la fixture `lead` | Los JSON estáticos se desincronizan del esquema; los endpoints no. |
| `cy.wait(500)` | Nada. Aserción web-first o `waitForFrame` (§3.6) | |
| `cypress/plugins/index.js` | `globalSetup` / `globalTeardown` | |
| `cy.viewport(...)` | Un proyecto con `devices[...]` | Mejor: `mobile-chrome` con `Pixel 7` en vez de cambiar el viewport a mitad de un test. |

Existen codemods comunitarios (`cypress-to-playwright` y similares). Sirven para
el 60 % mecánico —`cy.get` -> `page.locator`, añadir `await`— pero dejan
selectores CSS frágiles y nunca resuelven lo de A.2. Se usan como punto de
partida y se revisa spec por spec.

### A.2 Lo que no se migra: hay que reescribirlo

Cuatro patrones habituales en suites de Cypress que **no** tienen traducción en
este proyecto y se rehacen desde el escenario, no desde el código:

1. **Stubs de Evolution API con `cy.intercept`.** Las llamadas a Evolution
   salen del **backend** (`services/evolution_service.py`), no del navegador:
   interceptarlas en el navegador nunca funcionó de verdad, y si la suite
   antigua lo hacía es que probaba otra cosa. Se sustituye por el mock HTTP y
   `EVOLUTION_API_URL` (§3.5).
2. **Mocks de toda la API para "aislar el frontend".** Un E2E contra un backend
   simulado no prueba nada de lo que §1.3 lista como descubierto. Esos casos
   bajan a Vitest o a Storybook (§2); no suben a Playwright.
3. **Arrastre del Kanban.** Cypress necesita un plugin y eventos sintéticos
   para el arrastre HTML5 de `KanbanBoard.tsx`. Playwright lo hace con
   `locator.dragTo` y punteros reales; el test se reescribe entero y queda más
   corto.
4. **Cualquier caso con dos sesiones a la vez** (escenario 16: la mención en
   nota interna). Cypress no soporta dos usuarios simultáneos; en Playwright es
   `browser.newContext()` dos veces. Si la suite antigua lo simulaba haciendo
   logout y login, se tira y se rehace.

### A.3 Orden recomendado

1. Levantar la infraestructura de §3 (pila, fixtures, `storageState`) **antes**
   de tocar un solo spec. Migrar contra una infraestructura improvisada produce
   una suite inestable que nadie querrá arreglar después.
2. Migrar primero el spec de login, que es el que valida la infraestructura
   entera.
3. Luego, uno por uno y en el orden de prioridad de §4 —no en el orden
   alfabético de la carpeta antigua—, descartando por el camino todo lo que
   caiga en A.3 y todo lo que no cumpla dos criterios de §2. Una migración es
   la mejor ocasión que va a haber para borrar tests que no aportan.
4. Borrar Cypress del repositorio en el mismo PR que cierra la migración.
   Convivir con dos runners "por un tiempo" significa mantener dos, y en la
   práctica que ninguno se mantenga.
