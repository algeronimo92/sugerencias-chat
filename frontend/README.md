# Frontend

React 19 + TypeScript + Vite + Tailwind 4 + TanStack Query. Organizado por features;
los límites entre capas los verifica `src/test/architecture.test.ts`, no un linter.

## Comandos

```bash
npm ci
npm run lint      # oxlint
npm test          # vitest
npm run build     # tsc -b && vite build
npm run dev       # o, mejor, `docker compose up -d --build` desde la raíz: frontend en :5173
```

Los tipos de la API se generan desde el OpenAPI del backend con
`../scripts/generate-api-types.sh` → `src/api/schema.d.ts`; CI falla si quedan
desincronizados.

## Dónde está cada cosa

- `src/app/`: rutas, layout, providers — ver [src/app/README.md](src/app/README.md).
- `src/features/<feature>/`: `api.ts` (HTTP), `keys.ts` (claves de React Query),
  `queries.ts`/`hooks/`, `domain/`, `components/`, `public/` (lo que otras features
  pueden usar), `types.ts`.
- `src/shared/`: cliente HTTP, `ui/`, utilidades; no conoce features — ver
  [src/shared/README.md](src/shared/README.md).
- `src/realtime/`: WebSocket y bus de eventos.
- Tokens de diseño: `src/index.css` (`@theme`).

Reglas, comandos del repo y peligros: [../CLAUDE.md](../CLAUDE.md). Estado del proyecto:
[../docs/analisis/11-auditoria-senior-2026-11-04.md](../docs/analisis/11-auditoria-senior-2026-11-04.md)
(para este frontend: `strict` pendiente en `tsconfig.app.json`, F6).
