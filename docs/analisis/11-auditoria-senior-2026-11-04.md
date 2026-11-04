# 11 — Auditoría senior: negocio, arquitectura y operación

**Fecha:** 4 de noviembre de 2026.
**Referencia Git:** `0bf40fd` (`main`), 363 commits, 1.222 archivos versionados.
**Objeto:** modelo de negocio y sus puntos débiles; arquitectura, seguridad, datos, frontend, infraestructura, operación y proceso; qué mejorar a nivel técnico y de solución.
**Método:** tres revisiones paralelas (backend, frontend, infraestructura/negocio) sobre el árbol completo, con cada hallazgo reabierto después contra el archivo y la línea citados. Solo lectura: no se ejecutó nada contra producción ni se modificó código.
**Relación con informes anteriores:** sucede a [`09-auditoria-integral-2026-09-14.md`](09-auditoria-integral-2026-09-14.md) (33 hallazgos, H01–H33) y a [`10-workflows-n8n-meta-multitenant.md`](10-workflows-n8n-meta-multitenant.md). La sección 3 dice qué se cerró desde entonces y el anexo mapea cada H## a su estado actual. Los informes 01–08 y el plan 00 siguen valiendo como trazabilidad; sus prioridades están superadas por este documento.

### Lectura rápida

- [0. Veredicto](#0-veredicto)
- [1. Resumen ejecutivo](#1-resumen-ejecutivo)
- [2. Modelo de negocio y sus puntos débiles](#2-modelo-de-negocio-y-sus-puntos-débiles)
- [3. Qué cambió desde la auditoría 09](#3-qué-cambió-desde-la-auditoría-09)
- [4. Hallazgos consolidados](#4-hallazgos-consolidados)
- [5. Lo que está bien y no hay que "arreglar"](#5-lo-que-está-bien-y-no-hay-que-arreglar)
- [6. Hoja de ruta](#6-hoja-de-ruta)
- [7. Criterios de cierre](#7-criterios-de-cierre)
- [Anexo: trazabilidad 09 → 11](#anexo-trazabilidad-09--11)

---

## 0. Veredicto

| Área | Nota | En una línea |
|---|---|---|
| Arquitectura backend | **A** | Hexagonal de verdad: 40+ invariantes ejecutables en `backend/tests/test_layering.py`, cero `TODO`, ningún archivo de producción supera 700 líneas, cero N+1 en el lado de lectura. |
| Arquitectura frontend | **B+** | Features por capas verificadas por AST (`frontend/src/test/architecture.test.ts`), 0 `any`, 0 `@ts-ignore`… sobre un compilador con `strict` apagado que nunca estuvo encendido. |
| Seguridad de aplicación | **B** | Sesiones opacas, TOTP, PIN ligado a dispositivo, throttle, firma HMAC de Meta, AES-GCM con AAD por fila. Pero bcrypt corre en el event loop y un único token abre `/api/webhooks/*` de cualquier tenant. |
| Datos y esquema | **B-** | Índices y constraints pensados query por query; ingesta idempotente. Pero `leads` y `wsp_messages` están fuera de `alembic check` y `public.webhook_inbox` acumula PII de todos los negocios. |
| CI/CD | **A-** | Seis gates, incluida la suite completa contra PostgreSQL real y `alembic check`; blue-green verificado por hash a través de Traefik. Cero gates de seguridad o de dependencias. |
| Operación y DR | **D** | Los backups viven en el mismo disco que la base, ~126 GB de multimedia de pacientes no tienen copia y nunca se probó un restore. |
| Observabilidad | **C** | Stack completo con alertas que tienen tests unitarios… entregadas a un único webhook de n8n en otra VPS; la cola de entrada de Meta no tiene una sola métrica; cinco alertas de RabbitMQ disparan en falso desde septiembre. |
| Producto / negocio | **D+** | La plataforma multi-tenant está construida y en producción, pero no hay billing, planes ni límites; la IA que da nombre al producto vive en workflows sin versionar; bus factor 1. |

---

## 1. Resumen ejecutivo

Este repositorio tiene un nivel de ingeniería claramente por encima de su etapa. Las reglas de arquitectura no están en prosa: son tests que fallan. La ingesta de WhatsApp es correcta en los casos difíciles (reintentos de Meta, estados fuera de orden, procesos que mueren a mitad). El CI corre la suite dos veces, una con dobles y otra contra PostgreSQL físico. Los comentarios documentan el incidente que motivó cada decisión y los mensajes de commit están escritos en lenguaje de usuario. Nada de esto es habitual.

El riesgo está concentrado en lo que no es código:

1. **No existe recuperación ante desastre.** Si se pierde el VPS que aloja la aplicación —hardware, borrado, ransomware, suspensión del proveedor— se pierde la base **y** sus backups, y la multimedia de pacientes no tiene segunda copia en ningún escenario. Es el único hallazgo con potencial de terminar el negocio en un día.
2. **El sistema queda ciego cuando falla.** Las veinte alertas, incluidas `BackendCaido` y `PostgresCaido`, se entregan exclusivamente a n8n, el componente más frágil y que corre en otra máquina. Un corte de n8n no avisa de nada, incluido el corte mismo.
3. **El diferenciador del producto no está bajo control de cambios.** Los workflows de n8n (RAG de 104 nodos, analista de 19) están gitignoreados con buena razón —traen credenciales—, y el resultado es un activo sin historial, sin revisión, sin CI y en la cabeza de una sola persona que firma el 80 % de los commits.
4. **Se construyó la plataforma antes del producto.** Aislamiento multi-tenant impecable y cero billing. El segundo cliente no puede darse de alta sin tocar prompts hardcodeados de DermicaPro en n8n, y si se diera de alta no habría forma de cobrarle.

En código, los hallazgos críticos son pocos y baratos: bcrypt síncrono en el event loop (un DoS trivial), un token compartido que permite cruzar tenants por header, una cola de entrada sin métricas donde los mensajes que fallan diez veces desaparecen sin aviso, y un frontend cuyo tipado no verifica nada porque `strictNullChecks` nunca estuvo activo.

**Las tres cosas para las próximas dos semanas, en orden:** (1) copia diaria de los dumps fuera del servidor y un restore probado de punta a punta, (2) un segundo receptor de Alertmanager que no pase por n8n más una alerta Watchdog, (3) borrar la infraestructura de RabbitMQ y sus alertas huérfanas. Las tres son de días, bajan riesgo existencial, y ninguna está en los planes actuales.

---

## 2. Modelo de negocio y sus puntos débiles

### 2.1 Qué es y a quién sirve

**CRM conversacional de WhatsApp para clínicas estéticas**, vendido como SaaS bajo la marca **CliniVentas**. **DermicaPro** es el primer y hasta hoy único negocio dentro de él.

- **Cliente:** la clínica (`organizations` en el plano de control, `backend/app/db/models/control.py`). Cada una recibe su subdominio (`dermicapro.cliniventas.com`, `traefik/dynamic/active.yml`) y su propio schema de PostgreSQL.
- **Usuarios:** el equipo de la clínica, con dos roles (`admin` / `vendedor`, CHECK en `app/db/models/auth.py:22`). El admin configura plantillas, etapas, etiquetas, usuarios y catálogos; el vendedor atiende chats, mueve leads por el embudo y agenda citas.
- **Operador de plataforma:** un tercer plano (`platform_users`, panel en `admin.cliniventas.com`, `app/modules/platform/api.py`). Es el dueño del SaaS, no el cliente.
- **Problema que resuelve:** la clínica compra anuncios Click-to-WhatsApp en Meta y recibe leads en un número de WhatsApp. Sin el CRM, la atención vive en el teléfono de una recepcionista: sin pipeline, sin asignación por vendedor, sin plantillas, sin trazabilidad, sin control de la ventana de 24 horas.
- **"Sugerencias" en el nombre:** es el origen del producto. Un copiloto de ventas (RAG) propone hasta tres respuestas al vendedor —nunca escribe al paciente— y un analista clasifica etapa, objeción e interés y extrae datos del lead. El repo conserva el nombre de cuando eso era todo el producto.

### 2.2 Qué vende realmente vs. qué da nombre al repo

| Funcionalidad | Dónde vive | Evidencia |
|---|---|---|
| Leads, búsqueda (unaccent + trigram + teléfonos por dígitos), etapas configurables por negocio | **Nativa** | `app/modules/leads/`, `lead_stages` con `kind IN ('open','won','lost')` (`db/models/leads.py:223`) |
| Recepción y envío de WhatsApp, estados, reacciones, ediciones, media | **Nativa** | `app/integrations/meta_webhook/`, `app/integrations/meta/`, `app/modules/conversations/` |
| Plantillas internas y oficiales de Meta, interactivos | **Nativa** | `app/modules/catalogs/templates_api.py` |
| Automatizaciones visuales, round-robin, rate-limit, pausa por lead | **Nativa** | `app/modules/automations/` (6.188 líneas, hexagonal completo) |
| Tareas, notas con menciones, push, mensajes programados, biblioteca de media, dashboard | **Nativa** | `tasks/`, `notifications/`, `media/`, `leads/dashboard/` |
| Citas + Google Calendar | **Nativa** (con eco a n8n) | `app/modules/appointments/`, `app/integrations/google_calendar.py`; #75 aún manda la cita a n8n |
| Atribución de anuncios (CTWA) | **Mixta** | tabla `wsp_ad` nativa; la extracción vive en subworkflows de n8n no inventariados |
| **Sugerencias de IA (RAG)** | **100 % n8n** | `app/modules/ai/infrastructure/n8n_provider.py` → `N8N_WEBHOOK_URL` |
| **Analista de IA (etapas, extracción)** | **100 % n8n** | `n8n_provider.py` → `N8N_ANALYST_WEBHOOK_URL` |
| Nota de voz con ElevenLabs | **Nativa** | `app/integrations/tts_service.py` |

**Conclusión:** el CRM transaccional —lo que un cliente usa doscientas veces al día— es nativo, testeado y bien construido. Lo que queda en n8n es exactamente la *inteligencia*: el diferenciador frente a "una bandeja de WhatsApp más".

### 2.3 Estado real del multi-tenant

**Está hecho y en producción.** La documentación dice lo contrario y eso es un riesgo en sí mismo (ver H4).

| Evidencia | Dónde |
|---|---|
| Plano de control: `organizations`, `organization_domains`, `organization_branding`, `whatsapp_connections`, `platform_users`, `platform_settings`, `tenant_schema_versions`, `webhook_inbox` | `app/db/models/control.py`; revisión `d2b7c4e91a60_control_plane_multitenant.py` |
| Aprovisionamiento de schema por negocio recorriendo las 65 revisiones | `app/tenancy/provisioning.py`, `backend/scripts/provision_tenant.py` |
| `search_path` fijado en cada `BEGIN`; nombre de schema validado contra `^tenant_[0-9a-f]{32}$` | `app/db/session.py:30-46`, `app/tenancy/context.py:19` |
| Middleware que resuelve por `Host`, separa hosts de plataforma y de negocio, y falla cerrado | `app/tenancy/middleware.py:82-112` |
| Supervisor de workers: un ciclo por tipo que recorre los negocios activos | `app/workers/tenant_supervisor.py` |
| Runbook de corte ejecutado (`dermicapro_db`/`public` → `cliniventas_db`/`tenant_<id>`, incluidos ~126 GB de media) | [`../corte-a-cliniventas.md`](../corte-a-cliniventas.md); PRs #59–#65 |
| 13 suites de aislamiento (WS, media, cachés, workers, jobs de IA, webhook, provisioning) | `backend/tests/test_tenant_*.py`, `test_ws_tenant_isolation.py`, `test_media_tenant_isolation.py` |
| Wildcard DNS-01 para que "dar de alta un negocio no pida tocar el repo" | #73, `traefik/dynamic/active.yml` |

Lo que falta para que sea un SaaS **comercial**:

| Pieza | Estado |
|---|---|
| Aislamiento de datos, branding, alta/suspensión desde panel | ✅ |
| **Billing / facturación** | ❌ Cero. Ningún `stripe`, `mercadopago`, `invoice`, `subscription`, `billing` funcional en el código. |
| **Planes / tiers** | ❌ El único "entitlement" es `ai_enabled` + `ai_monthly_quota` (`control.py:50-54`), cuyo comentario invoca "el plan del negocio" — un concepto que no existe en ninguna tabla. |
| **Límites por tenant** (usuarios, mensajes, almacenamiento, automatizaciones) | ❌ Solo la cuota mensual de IA. |
| **Onboarding self-service** | ❌ Alta = operador en el panel + `provision_tenant.py` + aprovisionar número en Meta. El único `signup` del código es el Embedded Signup de Meta. |
| **RAG aislado por tenant** | ❌ Supabase `documents` sin filtro de tenant en lectura ni tenant en metadata de carga ([`10-…`](10-workflows-n8n-meta-multitenant.md) §2). |
| **Catálogo y prompts por tenant en n8n** | ❌ "`precios1`: catálogo HTTP fijo de DermicaPro"; "reglas particulares de DermicaPro dentro de prompts". |

**Lectura de CTO:** la plataforma técnica está adelantada respecto al producto. Se invirtió una cantidad notable de ingeniería en aislamiento por schema y el cuello de botella para monetizar está en otra capa: n8n y la ausencia de billing.

### 2.4 Puntos débiles del negocio y de la solución

**N1 — Es un SaaS que no puede cobrar, y el segundo cliente no entra sin reescribir n8n.** Ver 2.3. Las plantillas oficiales de Meta se cobran por conversación, ElevenLabs y el LLM por uso; el único medidor es `ai_usage_events`. No hay forma de repercutir el consumo a quien lo genera.

**N2 — El activo intelectual del producto no está versionado y nadie sabe con certeza qué corre en producción.** `.gitignore:35-57` excluye los exports de n8n, a propósito y con buena razón (el propio archivo documenta que `webhook msg update.json` se coló una vez con el token del CRM en claro). El resultado: el RAG y el analista no tienen historial, revisión, CI ni backup versionado. `10-…:10-11`: *"No se consultó la instancia n8n desplegada. `active: true` dentro de un export no confirma su publicación"*. Además `analista.json` conserva cinco nodos Postgres escribiendo `leads` y `wsp_messages` directamente, lo que es la razón declarada de que esas dos tablas estén fuera de `alembic check` (F3).

**N3 — Bus factor 1.** `git shortlog -sn --all`: 399 entradas de una persona, 62 de otra, 34 de `root`. En los últimos 60 commits, 56 son de la misma persona; en noviembre, 19 de 20. Y hay 16 commits firmados `root@chat.dermicapro.app` / `root@cliniventas.com`: código commiteado y mergeado **desde el servidor de producción**, el último en octubre. La documentación de *qué* y *por qué* es excepcional; el conocimiento operativo no está transferido: dónde vive MinIO (su propio doc dice *"ese dato hay que obtenerlo del operador"*, [`05-…:31`](05-plan-infra-terraform-minio.md)), qué corre en n8n, dónde están las claves de cifrado.

**N4 — Lock-in total a Meta, y la WABA es compartida entre tenants.** Un solo canal, sin abstracción de proveedor, tras decomisar la alternativa (Evolution, `6e6f63b`). `META_APP_ID`/`META_APP_SECRET` son "de la plataforma, no de un negocio" (`backend/.env.example`): el *Tech Provider* es CliniVentas. Un cliente que queme su número con automatizaciones agresivas arriesga la App de Meta compartida por todos, y no hay límites por negocio que lo contengan.

**N5 — Métricas de operación, no de ROI.** El dashboard da leads nuevos, tiempo medio de respuesta y distribución por etapa/vendedor. Lo que una clínica compra es costo por lead, conversión por anuncio e ingreso por tratamiento. La tabla `wsp_ad` con `ctwaclid` existe; la cadena que la llena vive en subworkflows de n8n (`SUB - save CTWA`, `pixel lead`) que `10-…` pide inventariar antes de retirar la rama legacy. Sin ROI demostrable el producto compite por precio.

**N6 — Antecedente de mezcla de datos.** `scripts/export-por-marca.sh:5-7`: *"la base de `dermicapro_db` terminó conteniendo datos de seis marcas distintas (ver docs del incidente 2026-08-08)"*. Y [`../red-privada-wireguard.md`](../red-privada-wireguard.md): publicar PostgreSQL en la IP pública *"es exactamente el hallazgo que abrió la auditoría de este proyecto"*. Para un CRM con conversaciones de pacientes, es exposición regulatoria, no solo deuda.

**N7 — Deriva de identidad.** Repo `sugerencias-chat`, red y volúmenes `dermicapro-*`, Grafana en `grafana.chat.dermicapro.app`, producto `cliniventas`, defaults de código con la marca del primer cliente (`config.py:88,113,187`). Cuatro nombres para una cosa confunden a quien llega y filtran la marca de un tenant en la plataforma.

---

## 3. Qué cambió desde la auditoría 09

### 3.1 Cerrado con evidencia

| 09 | Qué pedía | Cómo se cerró |
|---|---|---|
| H01, H02 | Build roto, contrato de contactos | CI verde con `api-types-check`; Evolution retirado |
| H03 | Outbox reenvía mensajes aceptados | `classify_send_failure` (RETRYABLE/DEFINITIVE/UNCONFIRMED), `dedupe_key` UNIQUE, `asyncio.shield` en `_persist_sent` (`conversations/infrastructure/outbox_worker.py`) |
| H04 | WS conserva acceso tras revocar | `SocketOwner(user_id, organization_id)` y `disconnect_organization()` (`app/realtime/ws_manager.py:22`); origen validado antes de leer la sesión (`test_route_security.py:85`) |
| H05 | Webhooks sin autenticación | Firma HMAC-SHA256 sobre el body crudo con `compare_digest` y `RuntimeError` si falta el secreto (`meta_webhook/auth.py`); `INBOUND_WEBHOOK_TOKEN` obligatorio para arrancar (`runtime.py:246`) |
| H06 | SVG activos | `ALLOWED_DOCUMENT_TYPES` explícito (`media/media_upload.py:8-12`) |
| H08 | Backup informa éxito ante error | `db-backup.sh` borra el dump si `pg_dump` falla, rechaza <1 KB, verifica con `pg_restore --list` |
| H13 (mitad) | Login sin límite de intentos | `login_throttle.py`: 5/cuenta, 30/IP, reserva el intento antes de verificar |
| H14 | Caché del usuario anterior tras 401 | `endSession()` hace `setQueryData` antes de `removeQueries`, con el bug de orden documentado (`frontend/src/shared/queryClient.ts:32`) |
| H15, H16 | Cachés y estado local entre réplicas | `app/db/signals.py` (LISTEN/NOTIFY cifrado), `SKIP LOCKED`, `test_tenant_caches.py` |
| H17 | Deploys simultáneos | `concurrency: deploy-production` (#72); `conservar_color` en el deploy |
| H19 | `minio-setup.sh` rota el secreto | Idempotente, no rota sin pedirlo |
| H22 | Alembic por tabla testigo | `scripts/migrate.py` con `stamp` de baseline y advisory lock; `alembic check` en CI |
| H27 | CI sin DB real | `migrations-check`: vacío → head, `downgrade -1`/`upgrade`, `alembic check`, suite con `TEST_DATABASE_URL` |
| H29 | Citas con efecto externo previo | Las citas se guardan primero en PostgreSQL; Google y n8n son opcionales |
| H30 | Acoplamiento | Refactor modular completo (fases 0–7, 2026-10-02) con `test_layering.py` |

### 3.2 Sigue abierto

H13 (bcrypt, → S3) · H18/H20 (MinIO sin inventario, backup offsite, restore, → E1) · H21 (roles SQL separados; no reverificado) · H24 (root en contenedor, `docker.sock`, → S5/S6) · H26 (n8n no reproducible, → E3) · H28 (observabilidad verde mientras falla, → E2/F1) · H31 (PII y retención, agravado por `webhook_inbox`, → S2) · H33 (acceso global por vendedor; no reverificado) · Playwright E2E ([`04-…`](04-plan-testing-playwright.md)) y Terraform MinIO ([`05-…`](05-plan-infra-terraform-minio.md)) sin adoptar.

### 3.3 Nuevo desde 09 (no existía, o no se vio)

Inbox de Meta sin métricas (F1) · token cross-tenant por header (S1) · `EXTERNAL_TABLES` con la razón caducada (F3) · pool contra 32 pasadas concurrentes (P2) · `NOTIFY` >7500 B perdido en la topología de producción (F4) · regresión de puertos en `compose.prod.yml` (S4) · `strict` apagado en el frontend (F6) · RabbitMQ huérfano con alertas en falso (F2).

### 3.4 Documentos cuyo estado declarado es falso

| Archivo | Dice | Realidad |
|---|---|---|
| [`../multi-tenant-saas-plan.md`](../multi-tenant-saas-plan.md) | "todavía no implementado" (2026-09-17) | En producción desde el corte (#59–#65); 13 suites de aislamiento. Nota de estado añadida el 2026-11-04 (también en los tres docs siguientes) |
| [`../refactor-integracion-meta-cloud-api-nativa.md`](../refactor-integracion-meta-cloud-api-nativa.md) | "Estado: propuesto" (2026-09-24) | Ejecutado: `523fa93` webhook directo de Meta, `6e6f63b` decomiso de Evolution (2026-09-16) |
| [`../rabbitmq-ingesta-n8n-plan.md`](../rabbitmq-ingesta-n8n-plan.md) | "Estado: desplegado" | Describe Evolution → RabbitMQ → n8n, un flujo que ya no existe |
| [`../rabbitmq-eventos-plan.md`](../rabbitmq-eventos-plan.md) | "No es lo que se está construyendo hoy" | El paso que proponía se hizo por otra vía; el plan quedó sin objeto |
| [`../../README.md`](../../README.md) (sección "Desarrollo local") | frontend `5174`, PostgreSQL `5433` | `compose.yml`: frontend `5173`, PostgreSQL `127.0.0.1:5432` — **corregido el 2026-11-04** |
| `.claude/agents/app-expert.md` | `backend/routers/`, `services/`, `frontend/src/components/` | Árboles retirados; `test_layering.py:106` prohíbe que vuelvan |
| `frontend/README.md` | Boilerplate de Vite | Reemplazado el 2026-11-04 por un README con comandos y punteros |

Quien llegue nuevo —o quien tenga que operar esto en una urgencia sin la persona que lo escribió— será activamente desorientado por diez mil líneas de documentación de altísima calidad y fecha equivocada.

---

## 4. Hallazgos consolidados

Orden: **E** existencial → **S** seguridad y aislamiento → **F** fiabilidad e integridad → **P** escalado y rendimiento → **H** higiene y mantenibilidad. Dentro de cada nivel, por radio de impacto × probabilidad. Esfuerzo: S (horas–2 días), M (1–2 semanas), L (más).

### E — Riesgo existencial

**E1 · No existe DR: backups en el mismo disco, multimedia sin copia, restore nunca probado — L**
`scripts/db-backup.sh:22-24` escribe en `db/backups/` del mismo VPS que la base. La única mención de copia externa es `README.md:172`, una frase dirigida a un humano: *"Cópialos fuera del servidor"*. No hay `rclone`, `restic`, `borg` ni destino configurado en `scripts/`, `README.md` ni `docs/`. Los ~126 GB de imágenes, audios y documentos de pacientes en MinIO no tienen script, cron ni mención de respaldo, en un servidor que `05-…:31` no sabe ubicar. `pg_restore --list` verifica que el índice del dump se lee, no que restaura. El cron de backup vive en una línea del README (`:176`), sin alerta si deja de correr. Sin WAL archiving: RPO de hasta 24 h para un CRM de citas médicas.
*Escenario:* pérdida del VPS por hardware, borrado accidental, ransomware o suspensión de Hostinger → se pierde la base **y** sus backups; la multimedia no vuelve en ningún escenario.
*Arreglo:* (a) `rclone`/`restic` nocturno de `db/backups/` a un bucket externo (B2/S3) con cifrado y retención; (b) `mc mirror` del bucket de MinIO a otro proveedor; (c) restore automatizado mensual a un contenedor efímero que corra `alembic check` y cuente filas; (d) gauge `backup_last_verified_timestamp` + alerta si pasa de 26 h; (e) RPO/RTO escritos.

**E2 · Todo el alerting depende de n8n, el componente más frágil — S**
`monitoring/alertmanager/alertmanager.yml:17` (`receiver: n8n`, único), `:24-28` (`url_file: /etc/alertmanager-secrets/n8n_webhook_url`), `:21` (`repeat_interval: 3h`). `BackendCaido`, `PostgresCaido`, `TraefikDesaparecido` y todas las `severity: critical` se entregan exclusivamente a un webhook de n8n en la otra VPS. Sin receptor secundario, sin alerta `Watchdog`. Hay SMTP configurado en la app y no se usa.
*Escenario:* cae n8n, la VPS B o la ruta entre ambas → el sistema queda ciego justo cuando algo falla; una alerta perdida no se reintenta hasta 3 h después.
*Arreglo:* receptor `email` con el SMTP existente para `severity: critical` (y opcionalmente Telegram); regla `Watchdog` siempre activa enrutada a un dead-man's-switch externo; `repeat_interval` de 1 h para críticas.

**E3 · El activo intelectual del producto no está versionado — M**
`.gitignore:35-57` excluye `rag*.json`, `analista*.json`, `webhook*.json`. `10-…:10-11` admite que no se consultó la instancia desplegada. `analista.json` escribe `public.leads` y `wsp_messages` con cinco nodos Postgres, lo que obligó a `alembic/env.py:47` a excluir esas tablas (F3).
*Escenario:* un `ALTER COLUMN` rompe n8n en silencio; un cambio en el prompt no tiene diff ni revisión; la persona que lo mantiene no está disponible y nadie sabe qué versión está activa.
*Arreglo:* script que exporte los workflows por API de n8n, strippee credenciales (ya existe el patrón en `backend/tests/fixtures/n8n/`) y los commitee en `n8n/workflows/`; job de CI que valide JSON y compare con los fixtures de contrato; terminar la paridad de `docs/n8n-sin-acceso-a-la-base.md` para retirar los nodos Postgres.

**E4 · Bus factor 1 y commits desde producción — M (proceso)**
Ver N3. 16 commits `root@` desde el servidor, el último en octubre de 2026.
*Arreglo:* runbook operativo versionado (dónde vive MinIO, claves de cifrado, acceso a n8n, cómo rotar `SETTINGS_ENCRYPTION_KEY`); segundo operador con acceso y una ejecución supervisada del deploy y del restore; prohibir `git commit` en el VPS (el deploy hace `git reset --hard origin/main`, así que cualquier commit local se pierde además de ser inauditable).

**E5 · SaaS sin forma de cobrar; segundo cliente bloqueado — L**
Ver 2.3 y N1. `control.py:50-54` es todo el modelo de entitlements.
*Arreglo (en este orden):* (1) aislar RAG y prompts por tenant en n8n o traer la IA al backend detrás de `AiProvider` (ya es un puerto, `app/modules/ai/application/`); (2) tabla `plans` + `organization_entitlements` con límites de usuarios, mensajes/mes, almacenamiento y automatizaciones, aplicados en los comandos; (3) medición de consumo (`ai_usage_events` ya existe; añadir plantillas enviadas y GB); (4) integración de cobro.

### S — Seguridad y aislamiento

**S1 · Un único token abre `/api/webhooks/*` de cualquier tenant — M**
`app/modules/auth/auth_service.py:146-160` (`verify_webhook_token` compara contra `platform_setting("inbound_webhook_token")`, clave de `PLATFORM_KEYS`, es decir, una para toda la instalación) + `app/tenancy/dependencies.py:32-40` (`bind_integration_tenant` elige el tenant por `X-Meta-Phone-Number-Id` que manda el cliente). Doce endpoints comparten el mismo token, lectura cruda (`/lead-messages-raw`) y escritura (`/lead-stage`).
*Escenario:* el token se filtra (log de n8n, export de workflow, ex-colaborador). Con él y una lista de `phone_number_id` —visibles en la consola de Meta— se lee el historial completo de cualquier negocio y se mueven etapas de leads ajenos, lo que dispara automatizaciones y envíos reales de WhatsApp (riesgo que el propio comentario de `auth_service.py:155-158` describe).
*Por qué importa:* rompe el aislamiento multi-tenant con un solo secreto, cuando el patrón correcto ya existe en `app/modules/ai/ai_job_tokens.py` (token firmado con `org`, `op`, `exp`, que no acepta el tenant por header).
*Arreglo:* token por organización en `whatsapp_connections` o extender el esquema de `ai_job_tokens` a todos los callbacks; mientras tanto, allowlist de IP de n8n en Traefik y tokens separados para lectura y escritura.

**S2 · PII de todos los tenants en `public.webhook_inbox`, sin cifrar y sin purga de fallidos — S**
`app/integrations/meta_webhook/inbox.py:85-95` guarda `payload=change` crudo (texto del mensaje, teléfono, nombre) en el schema compartido; `purge_processed` (`:161-170`) solo borra `status='processed'`. Un evento que agota los 10 intentos queda `failed` con el payload completo para siempre, en la tabla que ven el panel de plataforma y los scripts de `public`. Agravante: `app/db/signals.py` cifra con AES-GCM el mismo contenido cuando viaja por `pg_notify` "para que no quede legible en los logs de PostgreSQL".
*Arreglo:* purgar `failed AND attempts >= MAX_ATTEMPTS` tras una copia a dead-letter; cifrar `payload` con `secret_cipher` (AAD por fila ya existe) y descifrar en `claim_events`; o mover el payload al schema del tenant en cuanto `_tenant_for()` lo resuelve.

**S3 · bcrypt síncrono en el event loop — S**
`app/modules/auth/auth_service.py:21,25` (`bcrypt.hashpw`/`checkpw` directos) llamados desde `async def` en `auth/api.py:89,184,220,251`, `platform_auth.py:55`, `session_repository.py:324` (PIN). Es el único bloqueo CPU-bound sin `asyncio.to_thread` en un backend que tiene 36 usos correctos de él.
*Escenario:* `IP_LIMIT = 30` (`login_throttle.py:23`). Cinco IPs × 30 intentos con emails válidos = 150 × ~250 ms de loop bloqueado en serie: ~40 s en los que toda la API, los WebSockets y `/health/ready` dejan de responder; el healthcheck de Docker reinicia el contenedor. También pasa sin malicia con 20 vendedores entrando al abrir el turno.
*Arreglo:* `await asyncio.to_thread(bcrypt.checkpw, …)` en `verify_password`/`hash_password` y propagar `async` a los seis call sites.

**S4 · `compose.prod.yml` publica la API y nginx en todas las interfaces — S**
`compose.prod.yml:29-30` (`"8000:8000"`) y `:66-67` (`"80:80"`). Los overrides lo neutralizan (`compose.bluegreen.yml:19` `ports: !override []`), pero solo si se pasan los dos `-f`. Es la regresión del commit `4abc239 Stop exposing backend on host port 8000`. Por 8000 quedan accesibles `/metrics`, `/docs` y `/openapi.json`, exentos del middleware de tenancy (`app/tenancy/middleware.py:19-25`).
*Arreglo:* quitar `ports` del archivo base o atarlo a `127.0.0.1`; quitar `/docs` y `/openapi.json` de los paths exentos en producción.

**S5 · Contenedores como root, sin multi-stage, sobre tags flotantes — M**
`backend/Dockerfile:1` (`python:3.12-slim`), `:16` (`COPY . .`), `:20` (sin `USER`); `frontend/Dockerfile:8` (`npm install` en `dev`), `:22` (`nginx:alpine`). Uvicorn corre como root con `ffmpeg` recomprimiendo video y audio de entrada no confiable. Contradice la doctrina del repo, que pinea once imágenes de infraestructura a parche exacto y documenta por qué los tags móviles son peligrosos (`compose.mq.yml:28-31`).
*Arreglo:* `USER` no root, multi-stage con `pip install --prefix`, imágenes por digest, `npm ci` en todos los stages.

**S6 · Deploy por SSH como root, sin entorno protegido — M**
`.github/workflows/ci-cd.yml:205-212` (`appleboy/ssh-action` con `VPS_SSH_KEY`); `docs/corte-a-cliniventas.md:17`: *"Todo se corre en el VPS, como root"*. Un compromiso del secreto en GitHub = root en la máquina con la base, las claves de cifrado y el `docker.sock` de Traefik.
*Arreglo:* usuario `deploy` con sudo acotado a `docker compose`; GitHub Environment `production` con aprobación; rotar la clave.

**S7 · Un solo VPS sin firewall de host; PostgreSQL publicado; WireGuard diseñado pero no activo — M/L**
`compose.monitoring.yml:65-69`: ocho servicios en `network_mode: host`, *"abierto a Internet… y sin firewall delante"*, mitigado atando cada uno a `127.0.0.1` — un flag olvidado y el servicio está en Internet. `compose.db.yml:88-91` publica 5432 en una IP del host. `traefik/dynamic/grafana.yml:15-16`: el túnel está *"documentado pero no activo"*. Y app, base, broker, monitoreo y proxy comparten la máquina: un disco lleno por Loki tumba PostgreSQL.
*Arreglo:* `ufw`/`nftables` con default deny; activar WireGuard y hacer que PostgreSQL escuche solo en la interfaz del túnel; a medio plazo, base en otra máquina o gestionada.

**S8 · Cero cabeceras de seguridad — S**
`grep -rE 'Content-Security-Policy|X-Frame-Options|Referrer-Policy|Strict-Transport-Security|Permissions-Policy'` sobre `frontend/nginx.conf`, `traefik/`, `compose*.yml`, `backend/` → 0. La app renderiza contenido de WhatsApp ajeno; mitiga que solo linkifica `https?://` y no hay `dangerouslySetInnerHTML`, pero no hay última capa.
*Arreglo:* middleware de cabeceras en Traefik (HSTS, CSP con `nonce` para el script inline de tema, `frame-ancestors 'none'`).

**S9 · `AI_JOB_SIGNING_SECRET` cae a `inbound_webhook_token` en single-tenant — S**
`app/modules/ai/ai_job_tokens.py:42-50`: reutiliza un secreto HTTP como clave de firma HMAC. En multitenancy ya es obligatorio; eliminar el fallback.

### F — Fiabilidad e integridad

**F1 · La cola de entrada de Meta no tiene una sola métrica — S**
`app/realtime/queue_metrics.py` define 13 gauges (outbox, automatizaciones, programados, tareas, WS) y **ninguno para `public.webhook_inbox`**. `grep -rn "webhook_inbox\|meta_webhook" monitoring/` → 0. `inbox.py:115-120`: `attempts < MAX_ATTEMPTS` (10); el evento que lo supera sale de `claim_events` para siempre y `purge_processed` no lo toca.
*Escenario:* vence el `access_token` de Meta de un negocio; `_import_media` falla; a los 10 intentos el mensaje del paciente desaparece del CRM sin señal alguna. El equipo se entera cuando el cliente se queja — el problema que `queue_metrics.py:3-5` llama "la carencia más subestimada del sistema" y que se resolvió para la salida pero no para la entrada.
*Arreglo:* gauges `webhook_inbox_pending`, `webhook_inbox_failed`, `webhook_inbox_exhausted`, `webhook_inbox_oldest_pending_age_seconds` en un tick global; alertas sobre `exhausted > 0` y edad > 5 min.

**F2 · RabbitMQ es infraestructura muerta que el deploy toca y cuyas alertas disparan en falso desde septiembre — S**
0 referencias a `rabbit|amqp|aio_pika` en `backend/app` y `requirements.txt`. `mq/definitions.json:15,62` sigue declarando `evolution_exchange` y `q.wsp.inbound`; último commit a `mq/`: 2026-08-13, un mes antes de retirar Evolution. `ci-cd.yml:420-448` hace `up -d` + `provision.sh` en cada despliegue. `monitoring/prometheus/alert-rules.yml:80` (`IngestaSinConsumidor`, `severity: critical`, `rabbitmq_queue_consumers == 0`) es verdadera de forma permanente desde que n8n dejó de consumir; igual `IngestaSinMensajes` (`:110`), `IngestaAcumulandose`, `DlqConMensajes`, `RabbitMQCaido`.
*Por qué importa:* ~7 semanas de críticos falsos cada 3 h → cuando `PostgresCaido` dispare de verdad se perderá en el ruido. Y cada deploy añade un servicio que nadie usa a la ruta crítica.
*Arreglo:* borrar `mq/`, `compose.mq.yml`, las cinco alertas y sus tests, el job de Prometheus y el bloque de CI; `docker compose -f compose.mq.yml down -v` en el servidor.

**F3 · `leads` y `wsp_messages` fuera de autogenerate: deriva de esquema garantizada — M**
`backend/alembic/env.py:47` (`EXTERNAL_TABLES = {"leads", "wsp_messages"}`), `:85-86` (excluidas de table, column e index comparison). `app/db/models/leads.py:111-115`: el modelo `Lead` declara **un solo índice** (`idx_leads_vendedor_id`) para la tabla que se filtra por `estado`, `origen`, `conversacion_abierta`, `last_read_at`, `fecha_recontacto`, `proxima_cita`. La revisión `a5b229ee1c70_deriva_aplicada_a_mano_en_produccion.py` demuestra que ya ocurrió una vez. La razón original —n8n escribía directo— está caducando (`docs/n8n-sin-acceso-a-la-base.md`, endpoints `/lead-raw` y compañía), pero la exclusión sigue cubriendo las dos tablas más importantes del producto.
*Escenario:* `alembic check` pasa en verde en CI; se aprovisiona un tenant nuevo recorriendo las 65 revisiones y le faltan los índices que producción tiene a mano; su chat list es 10× más lento y nadie sabe por qué.
*Arreglo:* `pg_dump --schema-only` de producción; revisión que alinee ORM (índices, columnas de n8n, triggers de `028_*.sql`); sacar las dos tablas de `EXTERNAL_TABLES`.

**F4 · Un aviso de tiempo real mayor de 7500 bytes solo llega a una réplica, y en producción es la que no tiene sockets — S**
`app/db/signals.py:51` (`MAX_NOTIFY_BYTES = 7500`), `:118-126` (si no cabe: `logger.error` y `return None`, "se atiende solo en este proceso"). En producción la API corre con `RUN_WORKERS=false` y el trabajo de fondo en el proceso `worker`, que no tiene conexiones WebSocket. Un mensaje con plantilla interactiva grande o `referral` de anuncio puede superar el límite incluso comprimido.
*Arreglo:* cuando no quepa, enviar un puntero (`{"refetch": "chats", "organization_id": …}`) y que la réplica receptora emita un `chats_updated` genérico; alerta sobre el `logger.error`.

**F5 · El certificado de Grafana no lo cubre el resolver actual — S**
`traefik/dynamic/grafana.yml:22-30` pide `Host(grafana.chat.dermicapro.app)` con `certResolver: letsencrypt`; sus comentarios (`:5-9`) hablan de HTTP-01. Desde #73 el resolver usa DNS-01 con el proveedor Hostinger y el wildcard emitido es `*.cliniventas.com` (`active.yml`); los dos desafíos no conviven en un resolver. Si la zona `dermicapro.app` no está en la cuenta del token, Grafana se queda sin certificado en la próxima renovación y nadie lo verá.
*Arreglo:* mover Grafana a `grafana.cliniventas.com` bajo el wildcard, o un segundo resolver.

**F6 · El frontend compila sin `strict`: ninguna anotación `| null` verifica nada — L**
`frontend/tsconfig.app.json` no tiene `strict`, `strictNullChecks` ni `noImplicitAny`, y `git log --follow` muestra que nunca los tuvo. Toda la maquinaria de `Delivered<T>` con `Exclude<T[K], undefined>` (`src/shared/http/contract.ts:42`), los cientos de `string | null` de `types.ts` y `ApiError.status: number | null` están, hoy, sin verificar. Evidencia de que ya muerde: `src/features/chats/utils/mediaGroups.ts:66-70` hace `new Date(message.sent_at as string)` sobre un campo nullable; con `null`, `new Date(null)` es epoch 0 y la resta agrupa como álbum dos medias no relacionadas. Es doloroso porque el resto del tipado es ejemplar: 0 `any`, 0 `@ts-ignore`, una sola aserción encapsulada.
*Arreglo:* `"strict": true` en una rama, contar errores, cerrar por feature empezando por `shared/` y `auth/`; hasta entonces, `strictNullChecks` como job no bloqueante en CI para que el número solo baje.

**F7 · `features/auth/` no tiene un solo test — M**
0 de 62 archivos de test. `LoginPage.tsx` (663 líneas), `AccountSecurityDialog.tsx` (MFA, PIN, revocación de sesiones), `AccountActionPage.tsx` (invitaciones, reset) y `queries.ts` (146 líneas de mutaciones de sesión). Toda feature de negocio tiene tests (`chats` 13, `automations` 7); la de credenciales, ninguno.
*Arreglo:* tests de `useLogout`/`useSuccessfulLogin`, del flujo de PIN con lockout y del de invitación, con `msw` o con el cliente HTTP mockeado.

### P — Escalado y rendimiento

**P1 · El chat list ordena por un `LATERAL` que PostgreSQL no puede indexar — M**
`app/modules/conversations/chat_queries.py:411` (`order_keys = [last_message.c.sent_at.desc().nulls_last(), Lead.id.desc()]` sobre el `LATERAL` de `_last_message_subquery`, `:16-36`). El campo que debería soportar ese orden existe y está muerto: `app/db/models/leads.py:51-55`, *"Nadie la actualiza todavía en mensajes posteriores… solo sirve como fecha del primer mensaje"*.
*Escenario:* para servir 30 chats, PostgreSQL ejecuta el subplan por **cada** lead que pasa el filtro, ordena todo y corta. Con 500 leads son 500 subplanes por refresco; con 20.000, la pantalla principal pasa de milisegundos a segundos justo cuando el producto tiene éxito. Con `search` activo se suman dos subqueries más por fila.
*Arreglo:* mantener `leads.ultimo_mensaje_at` (o `last_activity_at`) desde `ports.inbox.touch_last_message` —el gancho ya está en `conversations/application/inbound.py`—, indexarlo con los filtros habituales y ordenar por él; el `LATERAL` queda solo para traer el contenido de las 30 filas de la página.

**P2 · El pool se agota en silencio a partir del octavo tenant — S**
`app/core/config.py:24-27` (`pool_size=10`, `max_overflow=20` → 30 conexiones), `app/workers/tenant_supervisor.py:56` (`concurrency: int = 8` por loop), `app/runtime.py:401-410` (4 `TenantLoop`). Con ≥8 negocios activos: 4 × 8 = 32 pasadas concurrentes, más el inbox global y las `control_session()`. `outbox_tick` puede retener su sesión hasta 90 s esperando a Meta. Cuando el pool se agota, `QueuePool` espera 30 s, levanta `TimeoutError`, `run_tick` lo loguea y sigue: el síntoma es "las automatizaciones de algunos negocios se saltan rondas", sin error visible ni métrica (no hay gauge de pool).
*Arreglo:* derivar `concurrency` del tamaño del pool; exponer `pool.checkedout()`/`overflow()` como gauges.

**P3 · El hilo del chat no está virtualizado — M**
`frontend/src/features/chats/components/ChatThread.tsx:452` renderiza `daySections.map(...)` completo; `@tanstack/react-virtual` está en el proyecto y se usa en `ChatList.tsx:287`, pero no aquí. Cada "Cargar mensajes anteriores" suma una página que nunca se desmonta, y cada ítem monta un `MessageBubble` de 577 líneas. En un celular de gama media, 10 páginas dejan el scroll y el composer con lag. `gcTime` de 30 min agrava: el historial de cada chat visitado sigue en memoria.

**P4 · Media de hasta 25 MB sube como base64 dentro de JSON, sin progreso — M**
`ChatComposer.tsx:37-41` (`readAsDataURL`), `features/chats/api.ts:47-52` (`data_base64`), límite de 25 MB en `MediaLibraryPage.tsx:13`. Cero `FormData` en `src/`. Un video de 25 MB es un string de ~33 MB en memoria y en el body, sin `onUploadProgress` ni reanudación; hay compresión para fotos (`shared/utils/media.ts:49`) pero no para video ni documentos. Relacionado con 09-H32.
*Arreglo:* `multipart/form-data` en `/api/chats/{id}/media` y `/api/media/upload`, con progreso.

**P5 · Carga inicial ≈294 KB gzip y `html2canvas-pro` estático — S**
Chunk `index` 227 KB gz con la feature `chats` completa + vendor Radix 50 KB en el camino crítico + CSS 17 KB (medido sobre `dist/` del 28-jul; `src/` cambió hasta el 2-nov: **re-medir**). `IssueReportDialog.tsx:2` importa `html2canvas-pro` estáticamente para una sola acción opcional. El splitting por ruta está bien hecho (recharts y xyflow aislados); falta `manualChunks` y un `import()` dinámico dentro del handler de captura.

**P6 · Clientes HTTP y envíos secuenciales — S**
`app/integrations/google_calendar.py:146-150` (y `:183,209,269`) crea un `httpx.AsyncClient` por llamada, a diferencia de `meta/client.py` y `n8n/client.py` que mantienen uno global; `app/modules/notifications/push_service.py:68-72` hace `to_thread` secuencial por suscripción.

### H — Higiene y mantenibilidad

**H1 · Backend sin linter ni type checker; una capa vacía con 26 imports muertos — S**
No existe `pyproject.toml`, `ruff.toml`, `mypy.ini` ni `.pre-commit-config.yaml`; `requirements-dev.txt` tiene solo `pytest` y `pytest-asyncio`; CI corre `compileall` y `pytest`. Consecuencia visible: `app/modules/auth/session_service.py:1-30` importa `hashlib`, `re`, `secrets`, `bcrypt`, `AuthSession`, `TrustedDevice`, `get_current_tenant` y 16 símbolos de `session_policies` sin usar ninguno, y sus 15 funciones son `return await session_repository.X(...)`. El `README.md` del módulo lo prohíbe, pero `test_layering.py:655` (`FLAT_MODULES`) no incluye `auth`. Hay ~15 imports muertos más repartidos.
*Arreglo:* `ruff` (reglas `F`, `I`) en `backend-checks`; colapsar `session_service.py`; añadir `auth` a `FLAT_MODULES`.

**H2 · Lint de frontend con dos reglas y seis supresiones inertes — S**
`frontend/.oxlintrc.json`: solo `react/rules-of-hooks` y `react/only-export-components`. Seis `// eslint-disable-next-line react-hooks/exhaustive-deps` (`app/layout.tsx:93`, `ChatList.tsx:396`, `ChatWorkspace.tsx:223,291`, `useThreadScroll.ts:245`, `WhatsappPanel.tsx:109`) para una regla que nadie verifica: ESLint no está instalado. Sin `.prettierrc` ni `.editorconfig`: comillas dobles y punto y coma en `ChatList.tsx`, simples y sin él en `ChatThread.tsx`, mezcla dentro de `MessageBubble.tsx`.
*Arreglo:* `categories: {correctness: error}` + `react-hooks/exhaustive-deps` en oxlint; `oxfmt` o Prettier en un commit de formato.

**H3 · Dependencias sin mecanismo de actualización ni auditoría — S**
Sin Dependabot/Renovate (`.github/` solo tiene `workflows/`), sin `pip-audit`/`npm audit`/escaneo de imágenes. Los 14 pines del backend son exactos y comentados, pero `Pillow==11.1.0` (decoders con historial de CVE) y `tzdata==2024.2` (reglas DST de hace dos años para `America/Lima`) se quedan atrás en silencio. `python-dotenv` es redundante con `pydantic-settings`.

**H4 · Documentación con estado falso — S**
Tabla en 3.4. Además `.codex/agents/system-auditor.toml` y `.claude/agents/app-expert.md` describen árboles retirados. Corregido junto con esta auditoría: `CLAUDE.md`, `app-expert.md`, notas de estado en los docs de 3.4, puertos del `README.md` y `frontend/README.md`. Pendiente: `.codex/agents/system-auditor.toml`.

**H5 · Scripts muertos y uno roto — S**
`scripts/add_contact_phone_support.py`, `add_order_message_support.py`, `add_priority_message_support.py` (22 KB), `inject_ad_referral.py`: parcheadores de workflows de n8n de la era Evolution, con tests que los importan. `backend/migrate_media_to_minio.py`: cumplido el 2026-07-23 (`54a77cd`), con su reporte `backend/media-migration-report.json` (45 KB, 244 nombres de archivos de pacientes) commiteado al lado. `scripts/export-por-marca.sh`: referencia ~20 tablas que no existen en el esquema (`brand_*`, `whatsapp_instances`, `integration_import_*`…), son de otro producto que compartía la base durante el incidente de agosto; falla en la primera consulta.

**H6 · Sin versiones, sin changelog, 75 ramas remotas — S**
`git tag` vacío. No hay forma de decir "producción corre la vX". Ramas `feat/` y `feature/`, `fix/` y `bugfix/`, `feature/automatizations` y `backup/main-pre-rebase-20260727` sin podar. Los mensajes de commit son excelentes; faltan los tags que los agrupen.

**H7 · Defaults con la marca del primer cliente — S**
`app/core/config.py:88` (`default_country_code = "51"`), `:113` (`minio_prefix = "dermicapro"`), `:187` (`vapid_subject = "mailto:soporte@dermicapro.com"`). En un SaaS deberían ser neutros o venir de `organization_branding`.

**H8 · Formateo de fechas duplicado 39 veces con locales mezclados — S**
`'es-PE'` en 30 sitios y `'es-AR'` en 3 (`LeadInfo.tsx:35`, `ChatItem.tsx:36`): la lista de chats muestra horas en formato argentino y el panel del lead al lado, en peruano. `shared/utils/datetime.ts` existe pero solo tiene tres helpers no relacionados. Además: PWA instalable con `registerType: 'prompt'`, push y manifest por tenant, pero inútil offline (sin persistencia de React Query ni cola de mutaciones); `useTheme` no escucha `storage` (dos pestañas se desincronizan).

**H9 · `tasks` y `notifications` casi sin tests; sin medición de cobertura — M**
~1.200 líneas de producción, dos archivos de test (`test_task_auto_completion`, `test_scheduled_dispatch`), nada de Web Push ni del ciclo de recordatorios (09-H10 sigue sin red). `pytest-cov` no está; "0,57 de ratio tests/producción" es lo único cuantificable.

**H10 · Sin agregación de excepciones ni tracing — M**
`grep -i sentry` → 0. Hay logging JSON con `request_id` y Loki, pero un 500 en producción se descubre leyendo Loki a mano; no hay deduplicación ni alerta por error nuevo.

---

## 5. Lo que está bien y no hay que "arreglar"

Para que ninguna de las acciones anteriores toque esto por accidente:

- **Las reglas de arquitectura son ejecutables.** `backend/tests/test_layering.py` (776 líneas, allowlists que solo pueden achicarse) y `frontend/src/test/architecture.test.ts` (322 líneas, grafo por AST). Explica por qué el refactor modular *se sostuvo*: cero `HTTPException` fuera de rutas, cero SQL en API, cero sesiones fuera de `app/db`, `shared/` sin alcanzar features ni transitivamente, axios en un solo archivo, claves de caché en `keys.ts`.
- **La ingesta de WhatsApp es correcta en los casos difíciles.** Inbox durable antes de responder 200; dedup por `sha256` del change canónico + `ON CONFLICT DO NOTHING`; UNIQUE parcial en `wa_message_id`; un único worker global ordenado para que un estado no se aplique antes que su mensaje; `SKIP LOCKED` para que dos colores convivan; recuperación de `processing` huérfano; estados y reacciones **reproyectados** desde `whatsapp_message_events`; adjuntos importados fuera del `if created` para que un reintento los complete.
- **El outbox** clasifica fallos (`RETRYABLE/DEFINITIVE/UNCONFIRMED`), reintenta la persistencia del envío cinco veces "porque perderlo dejaría al vendedor viendo 'no enviado' algo que el cliente recibió", y protege con `asyncio.shield` los puntos donde perder el registro es peor que fallar.
- **`app/db/uow.py`**: una unidad de trabajo por caso de uso en un `ContextVar`, anidamiento que se suma a la externa, eventos en dos fases (`transaction` antes del commit, `after_commit` solo si hubo commit).
- **Multi-tenancy fail-closed**: `TENANT_SCHEMA_RE` hace imposible la inyección por `search_path`; host desconocido → 404; `/api/platform/*` en un dominio de negocio → 404 con el motivo escrito; `resolve_tenant_by_waba_id` falla si hay ambigüedad.
- **Seguridad de sesión**: tokens opacos guardados como SHA-256, rotación con gracia de 90 s, PIN bcrypt ligado al token del dispositivo con lockout, TOTP con códigos de recuperación, throttle que reserva el intento antes de verificar y ordena los `FOR UPDATE` para evitar deadlock, firma de Meta sobre el body crudo con `compare_digest`, cifrado AES-GCM con namespace y clave en el AAD.
- **`pg_hba.conf` que falla cerrado** (`hostssl` obligatorio, `hostnossl reject`) y `ssl=on` sin interruptor: *"un TLS opcional se queda apagado el día que alguien despliega con prisa, y aquí viajan conversaciones de pacientes"*.
- **CI**: seis gates; la suite corre con dobles **y** contra PostgreSQL físico; `alembic check` valida ORM ≡ esquema; los tipos del frontend se regeneran y comparan; los configs de Prometheus/Loki/Alertmanager se validan con las versiones de producción; el deploy comprueba que el reload de Prometheus se aplicó leyendo `*_config_last_reload_success_timestamp_seconds`.
- **Blue-green**: la fuente de verdad es `active.yml`; migra antes de conmutar; `healthy()` exige `/health/ready` + nginx + worker; conmuta por `mv` atómico; compara el **sha256** servido vía Traefik con el del color — "que responda 200 no basta"; rollback en menos de un segundo.
- **`.gitignore` y comentarios escritos por cicatriz**: cada regla cita el incidente (`**/.env.bak*`, `/webhook*.json` y `/Webhook*.json`, `monitoring/secrets/n8n_webhook_url`, por qué `compose.mq.yml` monta el directorio y no el archivo, por qué `cors_origin_regex` no puede defaultear a `""`).
- **Frontend**: WebSocket con heartbeat + watchdog que detecta half-open tras suspender la laptop; ancla de scroll por `chat_id` en `ChatList` para que la lista no salte al reordenarse; cola de envío por chat con optimistic update y una sola reconciliación al final; tokens de color con pares claro/oscuro validados para daltonismo y contraste; tres layouts responsive con el umbral de 1280 justificado; `registerType: 'prompt'` para no borrar un borrador; 268 `aria-label`, `MotionConfig reducedMotion="user"`.
- **Mensajes de commit en lenguaje de producto**: *"editar o borrar en WhatsApp cambia el mensaje original, no suma uno nuevo"*, *"los ecos sin contenido del celular dicen que se mandaron, no que fallaron"*. Uno de los historiales más legibles que se pueden encontrar.

---

## 6. Hoja de ruta

Ordenada por riesgo que elimina, no por esfuerzo.

### Próximas dos semanas — bajar el riesgo existencial

| # | Acción | Esfuerzo |
|---|---|---|
| E2 | Segundo receptor de Alertmanager (SMTP ya configurado) para `critical` + alerta `Watchdog` a un dead-man's-switch externo | S |
| E1a | Cron de `rclone`/`restic` nocturno de `db/backups/` a un bucket externo cifrado; gauge y alerta de "último backup verificado" | S–M |
| F2 | Borrar `mq/`, `compose.mq.yml`, cinco alertas y su test, job de Prometheus y bloque de CI; `down -v` en el servidor | S |
| S3 | `bcrypt` a `asyncio.to_thread` en los seis call sites | S |
| F1 | Gauges y alertas de `webhook_inbox` | S |
| S2 | Purga de `failed` exhaustos (con dead-letter) y cifrado de `payload` | S |
| S4 | Quitar `ports` de `compose.prod.yml`; sacar `/docs` y `/openapi.json` de los paths exentos en producción | S |
| H4 | `CLAUDE.md`, `app-expert.md` (en este PR); notas de estado en los cinco docs y puertos del README (PR siguiente) | S |
| F6a | `"strict": true` en una rama, contar errores, decidir el plan por feature | S |

### Próximo trimestre

| # | Acción | Esfuerzo |
|---|---|---|
| E1b | Backup de MinIO (`mc mirror` a otro proveedor); inventario del servidor; restore automatizado mensual a contenedor efímero con `alembic check` y conteo de filas; RPO/RTO escritos | L |
| E3 | Exportar workflows de n8n saneados a `n8n/workflows/` + CI que valide JSON y compare contra los fixtures de contrato; cerrar la paridad de `n8n-sin-acceso-a-la-base.md` y retirar los nodos Postgres | M |
| S1 | Token por organización en `/api/webhooks/*` reutilizando `ai_job_tokens`; mientras tanto allowlist de IP en Traefik | M |
| F3 | `pg_dump --schema-only` de producción → revisión que alinee ORM → sacar `leads`/`wsp_messages` de `EXTERNAL_TABLES` | M |
| S5 | Dockerfiles: `USER`, multi-stage, imágenes por digest, `npm ci` | M |
| P1 | `last_activity_at` mantenido en los comandos de entrada/salida, índice compuesto, `LATERAL` solo para la página | M |
| H1–H3 | `ruff` en CI y colapso de `session_service.py`; oxlint con `exhaustive-deps` + formateador; Dependabot + `pip-audit`/`npm audit` | S cada uno |
| F7 | Tests de `features/auth/` | M |
| P2 | `concurrency` derivada del pool; gauges `pool_checked_out`/`pool_overflow` | S |
| P3, P4 | Virtualizar `ChatThread`; `multipart/form-data` con progreso | M |
| S8 | HSTS, CSP, `frame-ancestors` en Traefik | S |
| H5, H6 | Borrar scripts muertos y `media-migration-report.json`; tags semánticos + `CHANGELOG` generado del log; podar ramas | S |
| F4, F5 | Puntero en `NOTIFY` cuando no cabe; Grafana bajo el wildcard | S |

### Seis meses

| # | Acción | Esfuerzo |
|---|---|---|
| E5 | `plans` + `organization_entitlements` + medición de consumo + cobro | L |
| E3b | RAG y prompts aislados por tenant, o la IA al backend detrás de `AiProvider` | L |
| F6b | `strict` completo, feature por feature | L |
| S6, S7 | Usuario de deploy sin root y GitHub Environment con aprobación; firewall de host; WireGuard activo y PostgreSQL fuera de la IP pública; base en otra máquina o gestionada | M–L |
| H10 | Sentry (o equivalente) con `request_id` como correlación | M |
| E4 | Runbook operativo versionado; segundo operador con un deploy y un restore ejecutados bajo supervisión | M |
| N4 | Límites de envío por tenant (automatizaciones, plantillas/día) para proteger la WABA compartida; evaluar número/WABA por cliente | M |

---

## 7. Criterios de cierre

- **Dos semanas:** existe un dump de ayer en un bucket que no es el VPS, y una alerta disparó por SMTP sin pasar por n8n. `IngestaSinConsumidor` ya no existe. `/metrics` expone `webhook_inbox_exhausted`. 150 POST a `/api/auth/login` no degradan `/health/ready`. `docker compose -f compose.prod.yml config` no publica ningún puerto.
- **Trimestre:** un restore completo (base + muestra de media) se ejecutó en un entorno aislado y la app arrancó con `alembic check` verde. `n8n/workflows/*.json` están en `main` y CI falla si un export pierde un nodo del contrato. `alembic check` cubre `leads` y `wsp_messages`. `EXPLAIN` del chat list no muestra un subplan por lead. `ruff check` y `oxlint` con `exhaustive-deps` pasan en CI. `features/auth` tiene al menos los flujos de login, PIN e invitación cubiertos.
- **Seis meses:** un segundo negocio se da de alta, recibe sugerencias con su propio catálogo, tiene límites de plan aplicados y una factura generada; el deploy corre sin root; `strict: true` en `tsconfig.app.json`.

---

## Anexo: trazabilidad 09 → 11

| 09 | Estado | 11 |
|---|---|---|
| H01 Contrato de contactos / build | Cerrado | — |
| H02 `add_phone_jid` | Cerrado (Evolution retirado) | — |
| H03 Outbox reenvía | Cerrado | §5 |
| H04 WS tras revocar | Cerrado | §5 |
| H05 Webhooks sin autenticación | Cerrado | S1 (nuevo ángulo: token compartido entre tenants) |
| H06 SVG activos | Cerrado | — |
| H07 Descarga de URLs sin frontera | No reverificado | — |
| H08 Verificación de backup | Cerrado parcialmente (verifica, no restaura) | E1 |
| H09 Programados atascados | No reverificado (existe alerta `MensajesProgramadosParados`) | — |
| H10 Recordatorio no durable | No reverificado | H9 |
| H11 Filtro `unsupported` | No reverificado | — |
| H12 GET historial retiene SQL | No reverificado | — |
| H13 bcrypt + throttle | Mitad cerrada (throttle) | S3 |
| H14 Caché tras 401 | Cerrado | — |
| H15 Cachés entre procesos | Cerrado | — |
| H16 Estado local en blue-green | Cerrado, con residuo | F4 |
| H17 Deploys simultáneos | Cerrado | — |
| H18 MinIO provisión parcial | Abierto | E1 |
| H19 Script MinIO | Cerrado | — |
| H20 Recuperación incompleta | Abierto | E1 |
| H21 Privilegios SQL | Abierto (no reverificado) | S7 |
| H22 Alembic tabla testigo | Cerrado | — |
| H23 TLS según camino de despliegue | Parcial (guard de CI exige `DATABASE_SSL=require`) | S4 |
| H24 Contenedores sin presupuesto / `docker.sock` | Abierto | S5, S6 |
| H25 DLQ de RabbitMQ | Sin objeto | F2 |
| H26 n8n no reproducible | Abierto | E3 |
| H27 CI sin DB real | Cerrado | — |
| H28 Observabilidad verde mientras falla | Parcial (gauges de outbox; no de inbox; receptor único) | E2, F1 |
| H29 Citas con efecto externo previo | Cerrado | — |
| H30 Acoplamiento | Cerrado | §5 |
| H31 PII en logs / retención | Parcial (`signals.py` cifra; inbox no) | S2 |
| H32 Límites de bytes tarde | Parcial (413 en `MediaUpload`) | P4 |
| H33 Acceso global por vendedor | Abierto (no reverificado) | — |
