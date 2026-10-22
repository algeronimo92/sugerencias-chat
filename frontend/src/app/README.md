# Composición de la aplicación

Esta carpeta contiene la entrada de React y la composición de rutas, providers
y layout global extraída del `App.tsx` histórico. Puede importar features y
shared; no contiene lógica de una función de negocio concreta.

- `App.tsx`: composición mínima.
- `routes.tsx`: rutas lazy, guardas de sesión y autorización.
- `layout.tsx`: marco global autenticado y distribución de eventos en tiempo real.
- `providers.tsx`: React Query, animación, notificaciones UI y registro PWA.
