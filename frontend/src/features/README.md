# Features

Cada feature agrupa pantallas, llamadas HTTP, hooks de React Query, tipos y
pruebas de una capacidad de negocio.

## Capas

Una feature solo depende de features de capas inferiores. Así no hay ciclos y
queda claro quién compone a quién. La lista vive en `FEATURE_LAYERS`, en
`src/test/architecture.test.ts`; una feature nueva se ubica ahí antes de
importarla.

| Capa | Features |
| --- | --- |
| 0 | `auth` |
| 1 | `whatsapp` (modelo de mensajes, sin API propia), `catalogs` |
| 2 | `media`, `platform` |
| 3 | `leads` |
| 4 | `tasks` |
| 5 | `templates`, `appointments`, `ai` |
| 6 | `automations` |
| 7 | `chats` |
| 8 | `dashboard`, `notifications`, `issue-reports` |

Cuando una feature de abajo necesita que otra de arriba se entere de algo, no
la importa: la de arriba escucha el evento de tiempo real (`realtime.ts`) o
compone a la de abajo. Por ejemplo, el dashboard recalcula sus métricas desde
su propio módulo de tiempo real, y la columna derecha del chat (en `chats`)
compone la ficha del lead, las tareas y el copiloto de IA.

## Contrato entre features

Otra feature, o `app/`, entra solo por:

- `public/<archivo>.ts`: reexporta lo que se usa desde afuera, y nada más.
- `types.ts`, `page.ts` o `index.ts` en la raíz de la feature.

Las claves de caché viven en `keys.ts` y el tiempo real de cada feature en
`realtime.ts`; `app/realtime.ts` reúne los módulos.

Las piezas transversales se consumen desde `shared/`. Las páginas que
combinan varias features (como `CatalogsPage`) viven en `app/`.
