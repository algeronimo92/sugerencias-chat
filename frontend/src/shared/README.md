# Código compartido

Aquí se implementan piezas reutilizables sin reglas de una feature:
`http/client.ts`, `ui/`, utilidades genéricas, branding, query client y
tipos de transporte/identidad. El hook de sesión compartido representa la
identidad transversal; permisos/pantallas del negocio pertenecen a su feature.

No hay reexports hacia `components/`, `hooks/`, `domain/` ni `utils/` globales.
`shared` no alcanza ninguna feature ni `app`, incluso transitivamente; el
grafo de imports se verifica en `src/test/architecture.test.ts`.

Antes de añadir una pieza, revisar si contiene datos o reglas de una pantalla:
en ese caso va en `features/<dueño>/`, con un contrato concreto en `public/`
si otro consumidor la necesita. No crear carpetas sin implementación.
