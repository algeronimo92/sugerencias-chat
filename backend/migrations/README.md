# SQL histórico (congelado)

Estos archivos son el registro de cómo se aplicaba el esquema a mano antes de
Alembic. **No se agregan archivos nuevos acá ni se aplican en producción.**

Todo cambio de esquema va como revisión de Alembic en `backend/alembic/versions/`
y se aplica con:

```bash
python -m scripts.migrate
```

Aplicar un `.sql` de esta carpeta sobre una base gestionada por Alembic la
desvía del historial de revisiones y rompe el siguiente despliegue (una
revisión intenta crear lo que ya existe).

`tests/test_legacy_sql_migrations_frozen.py` falla si aparece un archivo nuevo.
