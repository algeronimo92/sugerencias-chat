# Pruebas de pantalla

La app compilada, en un navegador real (Playwright), a tamaño de escritorio y
de celular. El backend se simula en la red del navegador: no hace falta base,
ni backend, ni Docker.

Existen porque Vitest corre sobre jsdom, que no calcula tamaños ni posiciones.
Un menú que se sale de la pantalla o un cuadro de escritura tapado pasan todos
los tests de componentes; acá fallan.

## Correrlas

```bash
cd frontend && npm ci
```

```bash
cd e2e && npm ci && npx playwright install chromium
```

```bash
cd e2e && npm test                      # compila el frontend, lo sirve y corre todo
```

```bash
cd e2e && npm test -- --project=celular # un solo tamaño
```

```bash
cd e2e && npm run typecheck             # las respuestas simuladas siguen el contrato de la API
```

Si ya hay un servidor en `localhost:4173` se reutiliza (fuera de CI): después
de tocar el frontend hay que recompilarlo o cerrar ese servidor.

## Cómo está armado

| Ruta | Qué es |
|---|---|
| `playwright.config.ts` | Proyectos `escritorio` (1440×900) y `celular` (Pixel 7); sirve `frontend/dist` con `vite preview` |
| `fixtures/api.ts` | Backend simulado. Un pedido sin respuesta declarada hace fallar la prueba |
| `fixtures/crm.ts` | Datos base: sesión de admin, un lead, sus mensajes, flujos manuales |
| `fixtures/screen.ts` | Aserciones de posición: "entra entero en la pantalla", "nada desborda" |
| `specs/` | Un archivo por recorrido |

Las respuestas simuladas se tipan con `ApiResponse<ruta, método>`, el mismo
tipo que usa el frontend y que sale del OpenAPI. Si el backend cambia un campo,
`npm run typecheck` falla acá. Es lo único que se importa de `frontend/src`.

## Agregar una prueba

1. Escribir el recorrido en `specs/<área>/<recorrido>.spec.ts` importando
   `test` y `expect` de `fixtures/test.ts`.
2. Si la pantalla pide algo nuevo al backend, la prueba falla nombrando el
   pedido: declararlo en `fixtures/crm.ts` (si es de todas las pantallas) o en
   la propia prueba con `api.on(...)`.
3. Para lo que tiene que verse, usar `expectFullyOnScreen`: `toBeVisible` no
   detecta un elemento cortado ni uno fuera del área visible.

## Qué no cubren

- **Las barras del sistema del teléfono.** Un navegador emulado no dibuja la
  barra de botones de Android, el notch ni el teclado. El cuadro de escritura
  tapado por la barra de Android (#171) no lo habría detectado esta suite:
  eso se verifica en un equipo real antes de publicar cambios del chat.
- **El backend.** Acá no corre: que la API responda lo que estas pruebas
  simulan lo garantizan los tipos, no una llamada real. La suite de pila
  completa está diseñada en `docs/analisis/04-plan-testing-playwright.md` y se
  suma en esta misma carpeta.
