# Mapa de arquitectura modular

La entrada sigue siendo `uvicorn main:app`. `backend/main.py` expone la app
compuesta por `app/bootstrap.py`: middleware, routers, salud, WebSocket y
arranque/supervisión. Las reglas y la persistencia pertenecen a cada capacidad.

| Capacidad | Backend | Frontend |
|---|---|---|
| Identidad y sesiones | `app/modules/auth/` | `src/features/auth/` |
| Organizaciones y plataforma | `app/modules/platform/` | `src/features/platform/` |
| Leads y tareas | `app/modules/leads/`, `tasks/` | `src/features/leads/` |
| Catálogos y plantillas | `app/modules/catalogs/` | `src/features/leads/` (catálogos), `chats/` (plantillas) |
| Conversaciones y envío | `app/modules/conversations/` | `src/features/chats/` |
| Citas | `app/modules/appointments/` | `src/features/appointments/` |
| Automatizaciones | `app/modules/automations/` | `src/features/automations/` |
| IA | `app/modules/ai/` | `src/features/ai/` |
| Media | `app/modules/media/` | `src/features/media/` |
| Notificaciones | `app/modules/notifications/` | `src/features/notifications/` |
| Reportes | `app/modules/issue_reports/` | `src/features/issue-reports/` |
| Proveedores/webhooks | `app/integrations/` | — |

## Límites reales

Backend: `api.py`/`*_api.py` traduce HTTP; `service.py`/`*_service.py` expone
casos de uso; `repository.py`/`*_repository.py` conserva SQL y transacciones.
Las políticas/serializadores puros se separan cuando sirven a ambos. No se
fragmentan transacciones para obtener una estructura de carpetas uniforme.
Consultas especializadas de conversaciones conservan nombres explícitos como
`chat_queries.py`, `messages.py` y `message_history.py`; `message_outbox.py`
es dueño de la inserción atómica, deduplicación y recuperación del envío.

Los DTO HTTP viven en `app/modules/<dueño>/schemas.py`. Entre dominios, y
desde integraciones/workers, se consumen `public.py` o contratos concretos en
`ports/` con `__all__` explícito; no hay excepciones para importar internals.
Los puertos exponen sólo operaciones consumidas, no dominios completos.
El aprovisionamiento tenant compone operaciones acotadas de auth/plataforma,
controladas por una lista de operaciones, no una exclusión de todo el archivo.

`app/db/models/__init__.py` registra una única metadata de 54 tablas para
Alembic. El negocio importa ORM desde su archivo dueño. Control usa `public`;
tenant utiliza `app/tenancy/` y `app/db/session.py`. Los workers mantienen el
contexto por negocio; el inbox Meta tiene supervisión global.

Meta, n8n, Google Calendar, correo y almacenamiento MinIO/disco viven en
`app/integrations/`. `storage/media_storage.py` conserva `/media/` y el
aislamiento tenant sin cambiar rutas ni ubicación física de los archivos.
Los cuerpos externos de n8n viven en `n8n/webhook_schemas.py`.

Frontend: `src/app/` compone rutas, providers y layout. Cada feature contiene
UI, hooks/queries, `api.ts` para HTTP y tipos del dueño. Los consumidores de
otra feature usan operaciones en `public/`, o `types.ts`, `page.ts`, `index.ts`
del dueño; no importan componentes/hooks internos directamente.
`src/shared/` implementa cliente HTTP, UI y utilidades genéricas. No importa
features ni composición, tampoco por un puente transitivo. `src/realtime/`
mantiene conexión y distribución de eventos; invalidaciones de negocio quedan
en su feature. No existen los árboles globales de negocio anteriores.

## Garantías

`backend/tests/test_layering.py` cubre imports absolutos/relativos, inicializadores,
capas especializadas, DTO, puertos y proveedores. `frontend/src/test/architecture.test.ts`
comprueba el grafo TypeScript, límites transitivos y adaptadores HTTP.
Las rutas, seguridad, tenancy, outbox, WebSocket y orden de mensajes se protegen
con sus tests. OpenAPI mantiene 169 paths y 209 operaciones; los tipos generados
en `frontend/src/api/schema.d.ts` permanecen idénticos.

Migraciones desde cero, downgrade/upgrade y `alembic check` verifican el ORM.
`leads` y `wsp_messages`, compartidas con n8n, requieren migraciones explícitas:
su exclusión de autogeneración se conserva. La puerta PostgreSQL de CI usa
`TEST_DATABASE_URL` y no omite pruebas si esa conexión explícita falla.
