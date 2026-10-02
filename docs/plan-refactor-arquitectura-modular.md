# Plan de refactorización hacia un monolito modular

Estado: completado en su totalidad y verificado localmente el 2 de octubre de 2026, fases 0 a 7. Se cerraron también los acoplamientos de transición y `test_bluegreen_config.py`. Alcance: organización de backend y frontend, conservando el comportamiento y la topología de despliegue. No se realizó commit, PR ni despliegue; la ejecución remota de CI ocurrirá al publicar el cambio.

## 1. Objetivo y criterio de éxito

Agrupar el código por capacidad de negocio para que una persona pueda seguir una funcionalidad desde la pantalla hasta la persistencia sin recorrer listas globales de `components`, `hooks`, `routers` y `services`.

La refactorización está terminada cuando:

- Cada funcionalidad principal tiene un módulo dueño de sus endpoints, reglas, consultas, tipos y UI.
- `backend/main.py` conserva la entrada de Uvicorn; `app/bootstrap.py` compone la aplicación y los workers sin concentrar reglas de negocio.
- `frontend/src/app/` compone rutas y providers; no concentra la lógica de cada pantalla.
- Los módulos nuevos no importan las fachadas `services/db_service.py` ni `services/automation_service.py`.
- Las fachadas antiguas y los imports de compatibilidad se eliminan después de migrar sus consumidores.
- Los contratos HTTP, WebSocket, esquema de base de datos, autenticación y aislamiento entre negocios siguen funcionando igual.

## 2. Estructura destino

```text
backend/
├── main.py                         # Compatibilidad con uvicorn main:app
├── app/
│   ├── bootstrap.py                # Construcción de FastAPI y registro de routers
│   ├── core/                       # Configuración, logs y métricas
│   ├── tenancy/                    # Resolución, contexto y dependencias tenant
│   ├── db/
│   │   ├── base.py
│   │   ├── session.py
│   │   └── models/                 # Modelos ORM agrupados; Alembic importa todos
│   ├── modules/
│   │   ├── auth/
│   │   ├── leads/
│   │   ├── catalogs/
│   │   ├── tasks/
│   │   ├── conversations/
│   │   ├── automations/
│   │   ├── appointments/
│   │   ├── ai/
│   │   ├── media/
│   │   ├── notifications/
│   │   ├── issue_reports/
│   │   └── platform/
│   ├── integrations/               # Meta, n8n, Google Calendar, almacenamiento
│   ├── realtime/                   # Contrato y entrega WebSocket
│   └── workers/                    # Arranque y supervisión de tareas
├── alembic/
├── scripts/
└── tests/                          # Agrupados por capacidad

frontend/src/
├── app/                             # App, rutas, providers y layout general
├── features/
│   ├── auth/
│   ├── chats/
│   ├── leads/
│   ├── automations/
│   ├── appointments/
│   ├── ai/
│   ├── media/
│   ├── notifications/
│   ├── issue-reports/
│   └── platform/
├── shared/                          # Cliente HTTP, UI y utilidades reutilizables
└── realtime/                        # Conexión y distribución de eventos
```

La estructura es un mapa de responsabilidades, no una plantilla de carpetas vacías.
La infraestructura backend vive en `app/core/`, `app/db/`, `app/tenancy/`,
`app/integrations/` y `app/realtime/`. Se retiraron los árboles heredados
`services/`, `routers/`, `db/`, `tenancy/` y `models/` del backend, y
`components/`, `hooks/`, `domain/`, `utils/`, `types/` y `platform/` globales
del frontend. `shared/` contiene implementaciones reales, no puentes hacia
features o carpetas antiguas. No quedan fachadas globales ni excepciones de
imports internos entre dominios; las dependencias intencionales se expresan
mediante `public.py`, contratos `schemas.py` y puertos pequeños `ports/`.

Forma mínima de un módulo backend: `api.py` (HTTP), `schemas.py` (contrato), `service.py` (casos de uso) y `repository.py` (SQL). Crear más archivos solo si el tamaño o las responsabilidades lo justifican. Los modelos ORM se agrupan en `backend/app/db/models/` con un registro único para Alembic.

Forma mínima de una feature frontend: `api.ts` (llamadas), `queries.ts` (React Query), `types.ts` y `components/` cuando se necesiten. Los tests de componentes y hooks quedan junto al código que verifican.

## 3. Límites de dependencia

1. `api → service → repository → db`. Un repositorio no importa endpoints ni WebSocket.
2. `app/bootstrap.py` puede importar módulos; un módulo no importa el bootstrap.
3. Una feature frontend puede importar `shared` y su propio código; `shared` nunca importa una feature.
4. Los módulos hablan entre sí mediante funciones públicas pequeñas (`public.py` o `ports/<operación>.py` con exportaciones explícitas); los DTO se consumen desde `schemas.py`. Las features usan contratos concretos en `public/`, `types.ts`, `page.ts` o `index.ts` del dueño. Los eventos internos se usan solo donde la operación ya continúa después de un commit (por ejemplo, outbox y avisos en tiempo real).
5. Meta, n8n, Google Calendar y MinIO/disco son adaptadores. Las reglas de conversación, cita o IA permanecen en sus módulos.
6. `tenancy` y la sesión de DB son transversales. Toda entrada HTTP, WebSocket o worker debe establecer el contexto correcto antes de consultar datos del negocio.
7. `shared` y `core` no se convierten en carpetas de descarte: si algo pertenece a un negocio o pantalla, vive en ese módulo.

## 4. Contratos que no se deben alterar durante un traslado

| Contrato | Comprobación |
|---|---|
| Rutas, métodos, códigos, cookies y cuerpos JSON | Comparar OpenAPI generado y ejecutar tests de rutas; los tipos en `frontend/src/api/schema.d.ts` deben seguir sincronizados. |
| Eventos WebSocket y claves de React Query | Mantener nombres y payloads; comprobar `test_realtime_contract.py` y tests de hooks afectados. |
| Meta webhook | Mantener firma sobre bytes crudos, deduplicación y respuesta después de persistir en inbox. |
| Envío de mensajes | Mantener transacción `wsp_messages + message_outbox`, reintentos y distinción entre encolado y enviado. |
| Multitenancy | Mantener resolución por host/phone number/WABA, `search_path` por transacción y aislamiento de WebSocket, medios y workers. |
| PostgreSQL y Alembic | Una mudanza de archivos no debe producir DDL. Preservar también las excepciones de autogeneración para tablas compartidas con n8n. |
| Despliegue | Conservar `uvicorn main:app`, migraciones previas al arranque, nginx y blue-green hasta una decisión independiente. |

## 5. Fases de ejecución

Cada fase se entrega en uno o varios PR pequeños. No combinar traslados masivos con cambios funcionales.

### Fase 0 — Línea base y mapa de propiedad

**Estado: completada.**

- Registrar resultado actual de CI y del árbol de trabajo; preservar los cambios locales existentes.
- Inventariar imports de `db_service`, `automation_service`, `ws_manager`, `models.schemas` y `frontend/src/types/index.ts`.
- Asignar dueño a cada router, servicio, hook, componente y modelo. Documentar explícitamente lo que comparten dos módulos.
- Capturar OpenAPI y el conjunto de eventos WebSocket para comparar en fases posteriores.

**Salida:** matriz archivo → módulo y lista de contratos observables. Sin mover código todavía.

### Fase 1 — Estructura y reglas de importación

**Estado: completada.**

- Crear los paquetes `backend/app/`, `backend/app/modules/` y `frontend/src/features/` sin cambiar puntos de entrada.
- Definir una interfaz pública por módulo (`api`, servicio o funciones exportadas) y reglas de importación.
- Adaptar `backend/tests/test_layering.py`: hoy examina rutas literales bajo `routers/` y `services/`; sus garantías deben cubrir también los paquetes nuevos.
- Mantener `backend/main.py` como entrada estable durante la migración.

**Salida:** la estructura nueva convive con la antigua y CI sigue verde.

### Fase 2 — Módulo piloto: reportes de problemas

**Estado: completada.**

- Mover `routers/issue_reports.py` y `services/issue_report_service.py` a `app/modules/issue_reports/`.
- Mover `IssueReportsPage`, sus diálogos y `useIssueReports` a `features/issue-reports/`.
- Registrar el router nuevo desde la composición de FastAPI, conservando exactamente `/api/...` y permisos.
- Migrar tests que importan o hacen `monkeypatch` sobre los módulos anteriores; usar adaptadores temporales solo si existe un consumidor sin migrar.

**Salida:** un flujo vertical completo usa la estructura nueva sin cambios en OpenAPI ni comportamiento. Es la plantilla para las demás fases.

### Fase 3 — Frontend por funcionalidades

**Estado: completada.** Las pantallas de ruta están bajo su feature, los tipos
de dominio se declaran junto a su dueño y `app/` separa composición, providers,
rutas y layout. La fachada de tipos `types/index.ts` se retiró en la fase 7
después de migrar los imports de sus consumidores.

- Mover por grupos `auth`, `chats`, `leads`, `appointments`, `automations`, `ai`, `media` y `platform`.
- Partir `types/index.ts` por dueño; dejar en `shared` solo tipos de transporte o utilidades realmente comunes.
- Extraer de `App.tsx` el registro de rutas, providers y layout. Mantener carga diferida de pantallas, guardas de sesión y registro PWA.
- Conservar claves de React Query y la distribución de eventos WebSocket durante los movimientos.

**Salida:** las pantallas se localizan por feature; `App.tsx` queda centrado en composición. `npm run lint`, `npm test` y `npm run build` pasan.

### Fase 4 — Backend CRM y consultas

**Estado: completada.** Catálogos, tareas, leads y citas son dueños de sus
rutas, casos de uso, reglas y consultas. HTTP llama a servicios del dueño;
la persistencia atómica se mantiene en sus repositorios. Las consultas Kanban
pertenecen a leads y las consultas de mensajes a conversaciones. No quedan
adaptadores en `routers/` o `services/`. Citas conserva persistencia local
antes de Google Calendar/n8n y los estados de integración visibles.

Verificación: suite backend, contratos de rutas/WebSocket, OpenAPI y tipos
generados idénticos; migraciones sin DDL adicional.

- Migrar primero catálogos y tareas; después leads y citas.
- Llevar las funciones de `services/store/` a los repositorios de su dueño. Reducir `db_service.py` a medida que desaparecen consumidores.
- Separar validación HTTP, reglas de negocio y consultas; conservar los límites de transacción existentes.
- Mantener la integración de citas: persistencia local primero, luego Google Calendar/n8n con su estado visible.

**Salida:** los módulos migrados no importan `db_service.py`; rutas y auditoría de leads conservan sus contratos.

### Fase 5 — Conversaciones y Meta

**Estado: completada.** Conversaciones es dueño de mensajes, historial,
lectura, edición, outbox, entrega y recuperación. La recepción HTTP de Meta,
su inbox global y su proyección tenant viven en `app/integrations/meta_webhook/`.
WhatsApp se consume mediante el puerto del canal. Los adaptadores MinIO/disco
viven en `app/integrations/storage/`. No quedan aliases heredados ni consultas
de conversaciones a través de una fachada global.

Verificación: webhook y tenancy sobre PostgreSQL físico, orden/desempate de
mensajes, deduplicación, retry, media, outbox y WebSocket. La prueba AST de
orden examina los dueños actuales y falla si deja de encontrar consultas.

- Migrar `routers/chats/`, historial, estado de lectura, `message_outbox` y worker de envío como una secuencia de PR controlados.
- Migrar el webhook Meta, inbox y proyección después de fijar la interfaz del módulo de conversaciones.
- Mantener `whatsapp_channel` como frontera del proveedor y el contrato de eventos WebSocket.
- Verificar orden, deduplicación, retry, estado de entrega, archivos, aislamiento tenant y recuperación tras reinicio.

**Salida:** el recorrido `POST mensaje → outbox → Meta → webhook → WebSocket` sigue funcionando; no quedan imports de consultas de conversación a través de `db_service.py`.

### Fase 6 — Automatizaciones, IA, auth y plataforma

**Estado: completada.** Automatizaciones expone motor/scheduler mediante
contratos explícitos. IA separa perfil, conocimiento y proyecciones de recursos
y catálogo en repositorios del dueño. Auth separa sesiones/dispositivos de
las políticas criptográficas; notificaciones, media y configuración separan
SQL de coordinación y efectos. Los DTO HTTP residen en `schemas.py`, también
en auth y plataforma. n8n y sus callbacks autenticados viven en
`app/integrations/n8n/`; los workers conservan contexto y supervisión tenant.

Las dependencias entre dominios y desde integraciones/workers utilizan puertos
pequeños con exportaciones explícitas, sin lista de excepciones de transición.
Los tests de arquitectura cubren imports relativos, imports de módulos,
`__init__.py` y archivos `*_api.py`, `*_service.py` y `*_repository.py`.

- Mover el motor y scheduler de automatizaciones detrás de una API pública pequeña; eliminar consumidores de `automation_service.py` gradualmente.
- Separar el módulo IA de los adaptadores n8n y de los callbacks autenticados.
- Migrar auth y plataforma al final: manejan cookies, roles, plano de control y acceso entre negocios.
- Conservar la supervisión de workers por tenant y el worker global del inbox Meta.

**Salida:** fachadas retiradas; no hay imports internos de otros dominios ni excepciones de transición.

### Fase 7 — Modelos ORM y cierre

**Estado: completada.** El registro ORM carga una metadata de 54 tablas;
plano de control y dominios tenant conservan sus schemas y FKs. Se retiraron
fachadas, aliases de compatibilidad y carpetas vacías. Backend y frontend
tienen contratos explícitos de consumo entre capacidades; `shared/` no alcanza
features ni `app/`, ni siquiera por dependencias transitivas. Todas las features
con datos remotos tienen `api.ts`; hooks/queries conservan las claves de caché.
`main.py`, composición, workers, WebSocket y contratos HTTP permanecen estables.

Verificación final local (2026-10-02):

- Suite backend completa: 1140 tests aprobados, sin omisiones, incluido blue-green.
- PostgreSQL efímero: migración desde base vacía, downgrade/upgrade de la última
  revisión, `alembic check` sin operaciones nuevas y 12 tests de registro ORM,
  aislamiento tenant y webhook Meta. La misma puerta queda conectada a CI
  mediante `TEST_DATABASE_URL`; una DB explícita inaccesible falla, no se omite.
- OpenAPI: 169 paths, 209 operaciones y tipos generados byte a byte idénticos
  a `frontend/src/api/schema.d.ts`.
- Frontend: lint, 346 tests y build aprobados; 7 tests de arquitectura verifican
  límites directos y transitivos, además de retiro de árboles heredados.
- Docker: builds backend y frontend de producción aprobados, `nginx -t` con
  hostname backend real y smoke backend con paridad OpenAPI, registro ORM,
  ruta de almacenamiento y head Alembic `a6d2e9b41c73`.
- Blue-green: contrato `HostRegexp` multitenant, conservación de reglas/TLS
  durante cambio de color y puertos app/métricas exclusivos de loopback.

El mapa y la guía describen la implementación final. Las pruebas usaron
contenedores y base efímeros sin volúmenes persistentes, retirados al terminar;
no se conectó producción ni se hizo un despliegue.

- Dividir `db/models.py` por plano de control y dominios tenant, con un registro único que cargue todos los modelos para Alembic.
- Cambiar imports y tests de forma incremental; comprobar `public` y schemas tenant.
- Retirar adaptadores de importación, carpetas vacías y reglas temporales.
- Actualizar README, mapa de arquitectura y guía para agregar una nueva funcionalidad.

**Salida:** las puertas locales de arquitectura, contratos, tests, migraciones,
tipos API y Docker pasan. Las capacidades principales siguen el mapa destino,
sin puentes heredados ni deuda de imports internos registrada como excepción.

## 6. Puertas de verificación por PR

- Un PR de traslado conserva las rutas y contratos. Si cambia comportamiento, va en otro PR con su propio motivo y pruebas.
- Ejecutar los tests afectados y los checks existentes de CI: `python -m pytest`, `npm run lint`, `npm test`, `npm run build`, generación de tipos OpenAPI, `alembic check` y builds Docker según el área tocada.
- Si se mueve código inspeccionado por tests basados en rutas/AST (`test_layering.py`, `test_realtime_contract.py`), actualizar la búsqueda a la ubicación nueva sin desactivar la restricción.
- Al mover tests con `monkeypatch`, revisar que parcheen el símbolo consumido por el módulo nuevo y no un reexport inerte.
- Antes de mezclar cada fase, comprobar el diff de OpenAPI y que no aparezca una migración Alembic accidental.
- Para conversaciones, auth y tenancy, ejecutar además las pruebas específicas de aislamiento tenant, webhook, outbox y sesiones.

## Estado de pendientes

No quedan tareas de implementación pendientes dentro de este plan, incluido
el test blue-green antes diferido. CI remoto se ejecutará al crear/publicar el
PR; no se presenta una ejecución local como evidencia de CI remoto. El build
frontend conserva el aviso no bloqueante de tamaño de chunks y el host Python
3.14 muestra avisos de deprecación de FastAPI/Starlette; no alteran los contratos
ni las puertas aprobadas, y el runtime Docker continúa en Python 3.12.

## 7. Riesgos y decisiones de secuencia

- **Trabajo local en curso:** el repositorio ya contiene cambios sin confirmar en auth, leads, modelos y frontend. La implementación debe partir de una base coordinada y no sobrescribir esos archivos.
- **Imports de compatibilidad:** son transitorios. Cada fase anota quién todavía los usa; la fase 7 los elimina.
- **Alembic y n8n:** `db/models.py` se divide al final porque la generación de migraciones depende del metadata y algunas tablas/columnas tienen coordinación externa.
- **Tests estructurales:** varios codifican rutas antiguas; deben evolucionar con la arquitectura para seguir protegiendo los límites.
- **Tiempo real y workers:** emiten efectos posteriores al HTTP. Moverlos exige comprobar el ciclo completo, no solo el status del endpoint.

**Primer PR recomendado:** fases 0 y 1, seguido inmediatamente por el piloto de reportes de problemas. Si el piloto no reduce saltos entre carpetas o complica los imports, ajustar el árbol antes de migrar chats y automatizaciones.
