# Features

Cada feature agrupa pantallas, llamadas HTTP, hooks de React Query, tipos y
pruebas de una capacidad de negocio.

Las pantallas de ruta de `auth`, `chats`, `leads`, `appointments`,
`automations`, `ai`, `media`, `issue-reports` y `platform` viven aquí. Una
feature consume su propio código y superficies públicas pequeñas; no importa
directamente las carpetas globales heredadas `components`, `hooks` o `types`.

Las piezas transversales se consumen desde `shared/`; el antiguo reexport
global `src/types/index.ts` fue retirado. Los tipos de negocio se importan
directamente desde la feature dueña.
