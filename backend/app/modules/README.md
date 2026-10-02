# Módulos de negocio

Cada módulo reúne endpoints, contratos HTTP, casos de uso y acceso a datos de
una misma capacidad. La composición de FastAPI y los workers vive en
`app/bootstrap.py`; los modelos ORM se agrupan en `app/db/models/`.
Los DTO HTTP antes compartidos en `backend/models/schemas.py` están ahora en
`schemas.py` de cada módulo; `catalogs/public.py` expone la etiqueta que usa
la tarjeta de lead sin crear una dependencia circular.

```text
issue_reports/
├── api.py          # HTTP; valida y traduce errores a respuestas
├── schemas.py      # Contratos propios de la capacidad
├── service.py      # Casos de uso y coordinación de efectos
└── repository.py   # Consultas SQL y persistencia
```

`catalogs/`, `tasks/`, `leads/` y `appointments/` agrupan el CRM.
Sus rutas viven en `api.py` o en archivos `*_api.py`, las consultas en
`repository.py` y repositorios especializados, y las reglas puras en
`policies.py` cuando hay transiciones compartidas. `appointments/service.py`
coordina los conectores después de confirmar la cita local.

`conversations/` contiene los archivos `*_api.py` con
las rutas de mensajes, lectura y acciones; `chat_queries.py`,
`message_history.py`, `read_state.py` y los repositorios de mensajes
mantienen las consultas y transacciones. `message_outbox.py` conserva en un
solo lugar la inserción, deduplicación, retry y recuperación del worker;
`chat_messaging.py` construye los envíos y `chat_watcher.py` publica cambios.
`app.integrations.meta_webhook/` recibe el HTTP de Meta, persiste el inbox
global y proyecta eventos tenant. `app.integrations.whatsapp.channel` es
el puerto del proveedor. Los antiguos aliases de importación de chats,
store y webhook fueron retirados.

`automations/` contiene el motor y scheduler detrás de `public.py`.
`ai/` reúne perfiles, contexto, jobs, conocimiento y sugerencias; `auth/`
agrupa usuarios, sesiones, MFA y throttling; `platform/` gestiona
organizaciones, sesiones y configuración del plano de control. El cliente n8n y sus
callbacks autenticados viven en `app.integrations.n8n/`; la supervisión
de workers tenant vive en `app.workers/`. El inbox Meta conserva su
supervisión global. Las antiguas fachadas `db_service.py` y
`automation_service.py` fueron retiradas.

Las dependencias entre capacidades se consumen mediante `public.py`, DTO
de `schemas.py` o puertos concretos `ports/<operación>.py`. Cada puerto declara
sus exportaciones en `__all__` y sólo importa operaciones de su dueño; no
reexporta el dominio completo ni actúa como fachada global. También las
integraciones y los workers respetan esta frontera. No quedan imports internos
registrados como excepciones de transición.

IA mantiene normalización/composición en servicios y SQL en repositorios:
perfil/conocimiento propios, catálogo y recursos en repositorios de sus dueños.
Sesiones, notas internas, plantillas, media, notificaciones y configuración
separan las transacciones de políticas y coordinación. Una operación atómica
no se parte: por ejemplo, renombrar media y sus adjuntos usa un único commit.
MinIO/disco vive en `app/integrations/storage/media_storage.py`.

Reglas:

- `api.py`/`*_api.py` llama a casos de uso; no ejecuta SQL ni importa repositorios. Los DTO se declaran en `schemas.py`.
- `service.py`/`*_service.py` no importa HTTP ni SQL; delega persistencia atómica.
- `repository.py`/`*_repository.py` no importa HTTP, servicios ni tiempo real.
- Un módulo no importa `app.bootstrap`, `main`, `services.db_service` ni
  `services.automation_service`.
- Integraciones con proveedores viven en `app.integrations`; el servicio del
  módulo conserva la regla de negocio.

La infraestructura transversal vive en `app/core/`, `app/db/`,
`app/tenancy/`, `app/realtime/` y `app/integrations/`. El aprovisionamiento en
`app/tenancy/provisioning.py` compone operaciones acotadas y verificadas por símbolo: invoca auth y
plataforma para sembrar y suspender un tenant. No se deben crear nuevos aliases
de importación para módulos de negocio ni reintroducir código en las carpetas
heredadas `services/` o `routers/`.

Los tests de arquitectura incluyen imports relativos, imports de módulos e
inicializadores; no se puede eludir la regla usando un nombre especializado.
