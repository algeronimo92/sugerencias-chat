# 00 - Plan de mejoras consolidado

Fecha: 2026-08-05. Rama analizada: `feat/remove-unkown-types`.

Este documento no aporta hallazgos propios: consolida y prioriza los de los informes
`01` a `08` de esta misma carpeta, resuelve solapamientos entre ellos y propone un
orden de ejecución. Cada acción enlaza con el informe que la sustenta.

Todo el análisis es de **solo lectura sobre el código**. Salvo donde se indica
explícitamente, los hallazgos están **inferidos por lectura**, no medidos en
ejecución. Antes de tocar rendimiento, léase la advertencia de la Fase 3.

## Estado de los informes

| Informe | Contenido | Estado |
|---|---|---|
| `01-codigo-y-buenas-practicas.md` | Calidad de código, SOLID, duplicación, tipado | Completo |
| `02-bugs.md` | 15 bugs verificados, por severidad | Completo |
| `03-arquitectura-y-flujo-de-eventos.md` | Arquitectura real y flujos de eventos end-to-end | Completo |
| `04-plan-testing-playwright.md` | Plan de adopción de Playwright para E2E | Completo |
| `05-plan-infra-terraform-minio.md` | Terraform para MinIO | Completo |
| `06-consistencia-configuracion.md` | Coherencia entre ficheros de configuración | Completo |
| `07-analisis-mensajeria.md` | Evaluación de una capa de colas/eventos | Completo |
| `08-latencia-endpoints-y-servicios.md` | Latencia de endpoints y servicios externos | Completo |

## Hilo conductor del diagnóstico

Cuatro patrones explican la mayoría de los hallazgos, y conviene tenerlos presentes
porque la misma corrección resuelve varios síntomas a la vez:

1. **Se confunde "falló el envío" con "falló el guardado".** Es la causa del único
   bug crítico (mensajes duplicados a clientes reales) y reaparece en los
   recordatorios de tareas y en el estado de entrega. No es un problema de
   infraestructura: es manejo de errores demasiado grueso.
2. **La lógica de negocio está duplicada y ha divergido.** El renderizado de
   `{{variables}}`, la validación de plantillas interactivas y la definición de las
   acciones de automatización existen dos o tres veces cada una. Las copias ya no
   coinciden, y esa divergencia es un bug de producción (`{{fecha_actual}}`).
3. **Los valores por defecto son inseguros y el ejemplo de configuración los
   propaga.** Webhooks sin token, media efímera, healthchecks que nunca fallan.
   Quien siga `.env.example` despliega un sistema abierto que además pierde datos.
4. **No hay forma de saber qué está pasando.** Sin `correlation_id`, sin
   percentiles, sin comprobación de que los workers siguen vivos. Todo el informe
   de latencia es necesariamente inferido porque no existe una sola métrica
   agregada que consultar.

## Prioridad global

Ordenado por riesgo, no por esfuerzo. Las cuatro primeras filas son las que pueden
causar daño visible al negocio hoy.

| # | Acción | Fuente | Riesgo que elimina | Esfuerzo |
|---|---|---|---|---|
| 1 | Exigir `INBOUND_WEBHOOK_TOKEN` no vacío o fallar al arrancar | 02 (A-1), 06 (1) | Webhooks abiertos a Internet: inserción de mensajes y disparo de envíos reales por terceros | S |
| 2 | Separar el POST a Evolution de su persistencia y añadir clave de idempotencia | 02 (C-1), 07 (4.1) | Reenvío hasta 3 veces del mismo WhatsApp a un cliente | M |
| 3 | Forzar `MEDIA_STORAGE_BACKEND=minio` en producción y fallar si no está configurado | 06 (2), 05 (1) | Cada despliegue blue-green destruye el multimedia subido | S |
| 3b | Hacer `scripts/minio-setup.sh` idempotente y dejar de rotar el secreto en cada ejecución | 05 (1) | Reejecutar la provisión borra política y usuario, e invalida la credencial en uso | S |
| 4 | Timeout en el cliente MinIO | 08 (5) | ~40 descargas colgadas dejan la app sin servir endpoints síncronos | S |
| 5 | Mover `_recover_stale_jobs()` dentro del bucle, con corte a `failed` | 02, 03, 07 (4.2) | Cola de salida de un chat bloqueada indefinidamente | S |
| 6 | Persistir el recordatorio de tarea antes de entregarlo | 02 (A-4), 03, 07 (4.4) | Recordatorios que desaparecen sin rastro | S |
| 7 | `SELECT ... FOR UPDATE` en `set_message_reaction` | 02 (A-3) | Reacciones que se pisan y se pierden | S |
| 8 | Unificar el renderizado de `{{variables}}` en `automation_rules.render_variables` | 01 (#3), 02 (A-2) | `{{fecha_actual}}` con el día siguiente entre las 19:00 y medianoche | S |
| 9 | Leer `leads.ultimo_mensaje_at` / `ultimo_emisor` en vez de recalcularlas | 08 (1, 2) | El endpoint más caro del sistema pasa a index scan de 30 filas | M |
| 10 | `maxPages` en las infinite queries y subir el intervalo de polling | 08 (3) | Refetch de todas las páginas cargadas cada 5 s, sobre WebSocket ya activo | S |
| 11 | Sacar Evolution y n8n del camino del request | 08 (6, 7) | Apertura de chat y sugerencias colgadas hasta 30 s y ~93 s | M |
| 12 | Índice parcial `(chat_id, sent_at) WHERE sender='cliente'` | 08 (4) | `unread-count`, ventana de servicio y `awaiting_reply` sin índice | S |
| 13 | `ruff` + `mypy` en backend y `"strict": true` en `tsconfig.app.json`, en CI | 01 (#1) | Red que impide que reaparezca la mitad de los hallazgos | M |
| 14 | Healthcheck real en Traefik y `/health/ready` que verifique los 5 workers | 03 (5), 06 (7) | Promoción en blue-green de un backend con workers muertos | S |
| 15 | `correlation_id` y percentiles por endpoint en `performance.py` | 03 (5), 08 (11) | Imposibilidad de diagnosticar nada en producción | M |
| 16 | Redis pub/sub detrás de `ws_manager` | 07 (4.3), 03 (3) | Broadcasts que no cruzan entre colores en blue-green | M |
| 17 | Quitar el UNIQUE global de `wsp_messages.wa_message_id` | 03 (2) | En multi-tenant, mensajes de una org descartados como duplicados de otra | M |
| 18 | Partir `automation_service.py` (2737 líneas) y `db_service.py` (2001) | 01 (#8, #9) | Dos ficheros concentran el 20 % del backend y bloquean el multi-tenant | L |
| 19 | Adoptar Playwright para E2E: fases 1-2 del informe 04 | 04 (6) | Cero cobertura E2E hoy; ningún test cubre el camino WhatsApp -> UI | L |
| 20 | Llevar la provisión de MinIO a Terraform, importando lo existente | 05 (5) | Provisión artesanal, destructiva y no reproducible | M |

## Fases

### Fase 0 — Contención (1-2 días)

Acciones 1, 3, 4. Son cambios de pocas líneas que cierran un agujero de seguridad,
una pérdida de datos recurrente y el mayor riesgo de caída total. Ninguna requiere
refactorizar nada.

Añadir además, del informe 06: `${ACME_EMAIL}` con `:?` en
`traefik/reverse-proxy.docker-compose.yml:26` (hoy Let's Encrypt falla en silencio),
corregir el comentario de `CORS_ORIGINS` en `.env.example` (seguirlo tal cual impide
arrancar), y sacar `backend/media-migration-report.json` del control de versiones —
contiene un inventario de 244 archivos de pacientes.

**Criterio de salida:** el arranque falla ruidosamente si falta el token de webhook;
un despliegue blue-green conserva el multimedia; existe un `.env.example` que se
puede seguir literalmente y arranca.

### Fase 1 — Corrección de los bugs de datos (3-5 días)

Acciones 2, 5, 6, 7, 8. Todas comparten el patrón 1 del diagnóstico. Conviene
hacerlas juntas porque tocan las mismas rutas de error y se prueban con el mismo
tipo de test (simular fallo entre el efecto externo y su persistencia).

El informe 07 detalla el diseño de la idempotencia del outbox; no hace falta
tecnología nueva, solo un estado intermedio verificable.

**Criterio de salida:** un test que mata la conexión a Postgres justo después del
POST a Evolution y comprueba que el mensaje no se reenvía. Los otros cuatro, con
test de regresión cada uno.

### Fase 2 — Latencia (1 semana)

Acciones 9, 10, 11, 12, más los quick wins del informe 08: `Cache-Control immutable`
y ETag sobre ficheros de nombre UUID, y dejar de subir media en base64 (hoy son tres
copias en memoria de hasta 25 MB y un 33 % de sobrecoste).

**Advertencia importante:** el informe 08 es enteramente inferido por lectura de
código. Antes de optimizar conviene hacer la acción 15 (aunque sea su versión
mínima) y confirmar con datos reales dónde está el tiempo. La acción 9 es la
excepción: desnormalizar hacia columnas que ya existen y ya están indexadas es
correcto con independencia de lo que midan las métricas.

### Fase 3 — Red de seguridad y observabilidad (1 semana)

Acciones 13, 14, 15. Esta fase no entrega nada visible al usuario y por eso se cae
de los planes; es también la que decide si las anteriores se mantienen o se
degradan. El informe 01 la pone como su acción número 1 por esa razón.

Orden dentro de la fase: primero linters y tipos (13), porque el propio informe 01
señala que los arreglos de una línea de la Fase 1 quedan protegidos por ella; luego
formatear el frontend en un commit aislado antes de tocar esos ficheros.

### Fase 4 — Mensajería (3-5 días)

Acción 16. La recomendación del informe 07 es explícita y vale la pena citarla
entera: **arreglar el outbox de PostgreSQL y añadir Redis exclusivamente como bus de
pub/sub efímero para el fan-out de WebSocket entre procesos. Ningún broker de
colas.**

El razonamiento es sólido: el orden estricto por chat, la deduplicación por clave de
negocio y las esperas durables de días consultables desde la UI son difíciles en
cualquier broker y triviales en una tabla relacional. El diseño actual acertó. El
único agujero que Postgres no llena cómodamente es el pub/sub entre procesos, y
Redis lo resuelve tocando un solo fichero: los 76 emisores no se enteran.

Renuncias que el informe deja explícitas y conviene aceptar conscientemente: no hay
replay de eventos, los workers siguen haciendo polling, Redis pub/sub no garantiza
entrega (no debe circular por ahí nada que no se pueda perder), y los workers siguen
compartiendo event loop con la API.

### Fase 5 — Estructura y preparación multi-tenant (3-4 semanas)

Acciones 17 y 18, más el resto del Top 10 del informe 01 (unificar `ActionEditor`,
unificar la validación de plantillas interactivas, handler global de errores en vez
de `except Exception: raise HTTPException(500, str(e))`).

El informe 03 identifica que el verdadero coste del pivot multi-tenant no es añadir
`organization_id`: es que no existe un punto de estrangulamiento para el acceso a
datos. `db_service.py` más otros ocho servicios abren sesión propia, así que el
scoping obliga a auditar todo el backend. Partir esos ficheros en repositorios por
agregado (acción 18) es lo que convierte esa auditoría en algo acotado.

Tres puntos del informe 03 que **no están recogidos en `docs/multi-tenant-saas-plan.md`**
y deberían incorporarse a él:

- El UNIQUE global de `wsp_messages.wa_message_id` (acción 17).
- `chat_watcher` calcula una firma global de toda la tabla y toma el último mensaje
  del sistema entero: no es parametrizable por organización, hay que reescribirlo.
- `evolution_service._config()` resuelve una única instancia y `app_settings` no
  tiene dimensión de organización.

### Fase 6 — Testing E2E e infraestructura como código

Acciones 19 y 20. Son las dos únicas líneas de trabajo que no corrigen nada roto,
sino que evitan que lo corregido se rompa otra vez. Van al final por eso, pero la
acción 19 gana valor si se adelanta a la Fase 1: los bugs de datos son
precisamente los que un test E2E detecta y una prueba unitaria no.

**Testing (informe 04).** En este repositorio **no existe Cypress**: se verificó que
hay cero referencias. El frontend prueba con Vitest, Testing Library y Storybook, y
el backend con pytest. El plan es por tanto de adopción desde cero, no de migración,
y así lo advierte el propio informe.

El diseño propuesto levanta la imagen `frontend --target prod` con nginx para
reproducir el mismo origen que producción, aísla por namespacing de lead por worker
(no hay endpoint de borrado de leads), simula entrantes reproduciendo lo que hace
n8n y espera por trama de WebSocket en vez de por `sleep`. Incluye un
`compose.e2e.yml` completo y el job de CI.

Dos consecuencias prácticas a tener presentes:

- **No hay ni un `data-testid` en `frontend/src/components`.** El plan se apoya en
  roles y etiquetas ya existentes y solo pide dos testids nuevos, en un PR aparte.
- El mock de Evolution se inyecta por `EVOLUTION_API_URL`, pero `_config()` lee
  `get_effective_many`, así que `app_settings` pisa al entorno. Hay que contarlo con
  eso o el mock no se aplica.

**Infraestructura (informe 05).** El servidor MinIO no está declarado en ningún
compose del repo: es un endpoint externo. Lo que sí existe es
`scripts/minio-setup.sh`, que es el equivalente artesanal de lo que se llevaría a
Terraform, con dos defectos que la acción 3b corrige antes de nada: es destructivo
por diseño y rota el secreto en cada ejecución, imprimiéndolo por stdout para
copiarlo a mano.

El informe advierte explícitamente de lo que no pudo verificar: la versión y los
atributos del provider `aminueza/minio` hay que confirmarlos en el registry, y
ofrece la alternativa con `hashicorp/aws` + `s3_use_path_style` señalando que esa
vía no cubre las identidades. La adopción es por `terraform import`, con la
salvedad de que **las service accounts no se pueden importar** porque MinIO no
devuelve su secreto.

Un requisito previo real: la lectura tolerante de `_object_name_candidates`
(`backend/services/media_storage.py:102-121`) impide aplicar lifecycle por
categoría. Hay que resolver eso antes de poder expirar media antigua.

## Lo que funciona y no conviene tocar

Los informes coinciden en señalar aciertos del diseño actual que sería un error
perder durante las refactorizaciones:

- La serialización estricta por chat del outbox, con paralelismo entre chats.
- Las esperas durables de las automatizaciones, que sobreviven a cualquier reinicio
  y son consultables y cancelables desde la interfaz.
- La deduplicación por `event_key`.
- El outbox transaccional: insertar el mensaje y su job de envío en la misma
  transacción es la forma canónica de evitar la desincronización entre base de datos
  y cola. Un broker rompería esa propiedad.
- El estado de entrega es idempotente y monótono (le falta reconciliación, no
  corrección).
- `backend/.env` no está commiteado, ni ningún otro `.env`.
- Las versiones de Node 22 y Python 3.12 están alineadas entre Dockerfiles y CI.
