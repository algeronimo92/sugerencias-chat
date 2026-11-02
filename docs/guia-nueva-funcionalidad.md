# Agregar una funcionalidad

1. Elegir el módulo dueño en [el mapa](arquitectura-modular.md). Si es una
   capacidad nueva, crear `backend/app/modules/<capacidad>/` y
   `frontend/src/features/<capacidad>/`; no añadir lógica de negocio al
   bootstrap, a `shared/` ni a una fachada global.
2. Definir el contrato en `schemas.py` y `api.py`, la regla en `service.py` y
   las consultas en `repository.py` (separar más archivos solo si ayuda).
   Registrar el router en `app/bootstrap.py`. Acceder a otro dominio mediante
   su `public.py` o una operación concreta en `ports/` con `__all__` explícito,
   no sus detalles internos. Conservar las transacciones completas en el
   repositorio; separar políticas puras sin alterar el orden de efectos.
3. Si necesita persistencia, declarar el ORM en el archivo de dominio de
   `backend/app/db/models/` e importarlo en `app/db/models/__init__.py` para que
   Alembic lo registre. Elegir conscientemente `public` o tenant; crear la
   revisión Alembic y probar una base vacía y schemas tenant. No confiar en
   autogenerate para `leads` ni `wsp_messages`, que comparte n8n.
4. En el frontend, agrupar pantalla, consultas, tipos y pruebas en la feature.
   HTTP vive en `api.ts`; React Query y sus claves en `queries.ts`/hooks del dueño.
   Para consumir otra feature usar una operación en `public/` o un contrato
   `types.ts`, `page.ts`, `index.ts` del dueño. `shared/` no puede importar
   features ni composición, ni siquiera transitivamente.
   `src/app/routes.tsx` solo registra la ruta. Conservar las claves de React
   Query y el contrato WebSocket si se trata de un traslado.
5. Ejecutar pruebas afectadas y los controles de CI: `python -m pytest`,
   `npm run lint`, `npm test`, `npm run build`,
   `scripts/generate-api-types.sh`, `alembic check` y builds Docker. Para
   auth, conversaciones o tenancy, añadir pruebas reales de PostgreSQL,
   aislamiento, webhook, outbox y sesiones. La generación de tipos no debe
   alterar `frontend/src/api/schema.d.ts` en un refactor sin cambio de API.

Un traslado de archivos no debe modificar el comportamiento ni el DDL. Si
se necesita cambiar un contrato, hacerlo en un cambio separado con su motivo
y sus pruebas.

Para la puerta PostgreSQL, definir `TEST_DATABASE_URL` con una base efímera
ya migrada y ejecutar `test_model_registry.py`,
`test_tenant_postgres_integration.py` y `test_meta_webhook_postgres.py`.
Sin variable, se permite la conexión local de desarrollo de `db/.env`; con
variable explícita, una conexión inaccesible falla la prueba. CI proporciona
su propia base en `migrations-check`. Nunca usar producción para estas pruebas.

Al mover código, adaptar también los tests AST a los dueños nuevos y los
`monkeypatch` al símbolo realmente consumido. No resolver una prueba rota
restaurando un alias inerte, ampliando excepciones o dejando una parametrización
vacía. No crear subcarpetas `service`, `repository`, `public` o `platform`
sin código real; la estructura depende de responsabilidades, no de una plantilla.
