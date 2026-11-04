# sugerencias-chat (CliniVentas)

## Qué es

CRM conversacional de WhatsApp para clínicas estéticas, vendido como SaaS multi-tenant
(**CliniVentas**; un schema de PostgreSQL por negocio). **DermicaPro** es el primer tenant.
Backend FastAPI hexagonal + React 19 por features; Meta Cloud API nativa (recepción y envío);
n8n solo para la IA (sugerencias y analista) y callbacks; MinIO para media; Traefik blue-green.

Nombres que conviven y son lo mismo: repo `sugerencias-chat`, red y volúmenes `dermicapro-*`,
dominio `*.cliniventas.com`. "Sugerencias" es hoy una función del CRM, no el producto.

Estado real del proyecto, hallazgos y hoja de ruta:
[docs/analisis/11-auditoria-senior-2026-11-04.md](docs/analisis/11-auditoria-senior-2026-11-04.md).

## Mapa del repo

Fuente completa: [docs/arquitectura-modular.md](docs/arquitectura-modular.md).

| Ruta | Qué es | Referencia |
|---|---|---|
| `backend/app/{bootstrap,composition,runtime}.py` | Composición FastAPI, raíz de DI, arranque y workers | `backend/main.py` solo reexporta `app` |
| `backend/app/modules/<capacidad>/` | 13 módulos: leads, conversations, automations, appointments, ai, auth, platform, catalogs, media, notifications, tasks, issue_reports | [backend/app/modules/README.md](backend/app/modules/README.md) (forma de cada módulo) |
| `backend/app/{core,tenancy,db,realtime,integrations,workers}/` | Config/errores/eventos; resolución de tenant por `Host`; sesiones y modelos (`db/models/<módulo>.py`); WebSocket; Meta, n8n, storage, Google, correo, TTS | |
| `backend/alembic/versions/` | **Única fuente del esquema** (un solo head) | [backend/migrations/README.md](backend/migrations/README.md): los `.sql` están congelados |
| `backend/tests/test_layering.py` · `frontend/src/test/architecture.test.ts` | Reglas de arquitectura como tests | ver abajo |
| `frontend/src/{app,features/<15>,shared,realtime}` | Composición; una carpeta por feature; piezas sin reglas de negocio; bus de tiempo real | [frontend/src/app/README.md](frontend/src/app/README.md), [frontend/src/shared/README.md](frontend/src/shared/README.md) |
| `frontend/src/api/schema.d.ts` | Tipos generados del OpenAPI; CI falla si se desincronizan | `scripts/generate-api-types.sh` |
| `scripts/` · `backend/scripts/` | Operación del VPS (deploy, backup, TLS) · `python -m scripts.<x>` (dry-run salvo `--apply`) | |
| `compose.yml` · `compose.db.yml` + `compose.prod.yml` + `compose.bluegreen.yml` | Desarrollo · producción (la base vive aparte, una vez por servidor) | [README.md](README.md) (despliegue) |
| `compose.monitoring.yml` · `monitoring/` · `traefik/` | Prometheus, Loki, Alertmanager, Grafana · proxy y certificados | |
| `docs/analisis/NN-*.md` | Auditorías y planes, numerados | |

Para agregar una funcionalidad: [docs/guia-nueva-funcionalidad.md](docs/guia-nueva-funcionalidad.md).

## Comandos

Son los que corre CI ([.github/workflows/ci-cd.yml](.github/workflows/ci-cd.yml)); si uno diverge, manda CI.

```bash
# Desarrollo: frontend :5173, backend :8000, postgres 127.0.0.1:5432 (compose.yml).
# Entrar por http://dermicapro.localhost:5173 — `localhost` a secas es host de plataforma.
docker compose up -d --build

# Backend, tests con dobles (no tocan ninguna base). El override de DATABASE_URL es OBLIGATORIO: ver Peligros.
cd backend && DATABASE_URL=postgresql+asyncpg://u:p@localhost/db SECRET_KEY=dev python -m pytest

# Backend, suite contra PostgreSQL real (la base local de compose.yml; credenciales en db/.env).
# Con TEST_DATABASE_URL definida, los tests de Postgres FALLAN en vez de saltarse: es a propósito.
docker compose up -d postgres
cd backend && TEST_DATABASE_URL=postgresql+asyncpg://<user>:<pass>@127.0.0.1:5432/<db> \
  DATABASE_URL=$TEST_DATABASE_URL SECRET_KEY=dev python -m pytest

# Esquema (siempre con DATABASE_URL local explícito; alembic/env.py lee settings, no alembic.ini).
cd backend && DATABASE_URL=... SECRET_KEY=dev python -m scripts.migrate        # aplica head con advisory lock
cd backend && DATABASE_URL=... SECRET_KEY=dev alembic check                     # ORM ≡ esquema (lo corre CI)
cd backend && DATABASE_URL=... SECRET_KEY=dev alembic revision --autogenerate -m "..."   # y revisar a mano

# Frontend (lint = oxlint, test = vitest).
cd frontend && npm run lint && npm test && npm run build

# Tipos de API: regenerar y comprobar que no cambió nada (CI falla si hay diff).
scripts/generate-api-types.sh && git diff --exit-code -- frontend/src/api/schema.d.ts
```

## Reglas de arquitectura (las imponen tests; leer el test antes de discutirlas)

**Backend — `backend/tests/test_layering.py`** (40+ invariantes):
- `domain/` sin SQLAlchemy, FastAPI, httpx, `app.db`, `app.realtime`; `application/` solo habla con `ports/`.
- `HTTPException` solo en `*api.py` (más `bootstrap.py` y `tenancy/dependencies.py`); los casos de uso levantan `DomainError`.
- Solo `app/db` abre sesiones; dentro de una unidad de trabajo nadie abre sesión a mano; `publish` solo en adaptadores sin transacción.
- Solo `subscribers.py` habla con el WebSocket. Un módulo usa a otro por `public.py`, `schemas.py` o `ports/<op>.py` con `__all__`.
- Tablas ajenas solo en `FOREIGN_TABLES`; módulos planos (`catalogs`, `media`, `notifications`, `issue_reports`, `tasks`) sin `service.py` que solo reenvíe.
- Toda ruta nueva necesita guard o una entrada justificada en `PUBLIC_ROUTES` (`backend/tests/test_route_security.py`).

**Frontend — `frontend/src/test/architecture.test.ts`:**
- `shared/` y `realtime/` no importan `features/` ni `app/`, ni transitivamente; `app/` entra a una feature solo por `index`/`types`/`page`/`public`.
- `axios` solo en `shared/http/`; HTTP solo en `features/*/api.ts`; respuestas tipadas con `ApiResponse<ruta, método>`.
- Claves de React Query solo en `keys.ts`. Features en capas ordenadas (`auth` → … → `chats` → `dashboard`): una feature solo importa capas inferiores.
- Componentes ≤400 líneas salvo los ya listados en `KNOWN_LARGE_COMPONENTS`.

## Convenciones

- Commits en español, en lenguaje de producto (qué cambia para el usuario), prefijo convencional y `(#PR)`.
  Ejemplo real: `fix: el contador de no leídos cuenta solo los chats que la lista muestra (#70)`.
- Los comentarios explican el **por qué** y, si lo hubo, el incidente que motivó la decisión. No el qué.
- Las allowlists de los tests (`FOREIGN_TABLES`, `PUBLIC_ROUTES`, `PUBLISH_ADAPTERS`, `KNOWN_LARGE_COMPONENTS`…) **solo se achican**. No se arregla un test roto ampliándolas, restaurando un alias inerte ni vaciando una parametrización.
- Esquema: solo revisiones Alembic; nunca editar una aplicada; nada nuevo en `backend/migrations/` (un test lo bloquea). `leads` y `wsp_messages` están en `EXTERNAL_TABLES` (`backend/alembic/env.py`): autogenerate no las compara, su migración es explícita.
- Cambio de API → regenerar `schema.d.ts` en el mismo PR. Traslado de archivos y cambio de contrato/DDL van en PRs separados.
- Versiones pineadas exactas (`==`, imágenes a parche); no introducir tags flotantes.
- No crear carpetas o capas vacías "por plantilla" (`service/`, `repository/`, `public/` sin código real).
- `asyncio_mode = auto` en pytest: sin `pytest-asyncio` los tests async se saltan en silencio y la suite pasa sin ejecutar casi nada.

## Peligros (leer antes de ejecutar nada)

- **`backend/.env` apunta a la base de PRODUCCIÓN.** Lo lee todo lo que importe `app.core.config`: `pytest` sin
  variables, `uvicorn`, `import main`, `python -m scripts.migrate`, `alembic` (su `env.py` usa `settings.database_url`),
  `move_public_to_tenant`, `rekey_settings`. Exportar siempre `DATABASE_URL`, `SECRET_KEY` y, para Postgres,
  `TEST_DATABASE_URL` apuntando a la base local. `alembic/env.py` se niega a ejecutar DDL contra un host
  que no sea local (loopback, `*.localhost` o un servicio de Compose) salvo `ALEMBIC_ALLOW_REMOTE=1`; leer
  (`alembic check`, `migrate --check`) no lo pide. El resto (pytest, uvicorn, scripts) no tiene guarda.
- **Nunca `docker compose -f compose.prod.yml up` a secas**: publica 8000 y 80 en todas las interfaces y se salta
  Traefik. Producción se despliega con `scripts/deploy-bluegreen.sh` (CI lo hace en cada push a `main`).
- **Push a `main` despliega a producción** (job `deploy`, serializado). Merges con cuidado.
- Los exports de workflows de n8n (`rag*.json`, `analista*.json`, `webhook*.json`) están gitignoreados porque traen
  credenciales: no commitearlos. La versión saneada vive en `backend/tests/fixtures/n8n/`. Tampoco `db/tls/`,
  `.env*`, `monitoring/secrets/`.
- `/api/webhooks/*` resuelve el tenant por header y `/api/platform/*` solo responde en hosts de plataforma:
  leer `backend/app/tenancy/middleware.py` y `tenancy/dependencies.py` antes de añadir rutas ahí.
- Nunca construir un `search_path` o nombre de schema desde input: `TENANT_SCHEMA_RE` en `app/tenancy/context.py`.
- Varios `docs/*.md` tienen cabeceras de estado falsas (`multi-tenant-saas-plan` dice "no implementado" y está en
  producción; `refactor-integracion-meta-cloud-api-nativa` dice "propuesto" y está hecho).
  Lista en la auditoría 11 §3.4. Ante la duda, manda el código.

## Agentes

- `.claude/agents/app-expert.md`: reglas de negocio y dónde vive cada funcionalidad.
- `.claude/agents/ui-ux-expert.md`: diseño, tokens (`frontend/src/index.css`), accesibilidad.
