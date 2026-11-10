/// <reference types="vite/client" />

/** Identificador del build, inyectado por `define` en vite.config.ts. Se
 * escribe en consola al registrar el service worker y al aplicar una versión
 * nueva, para poder decir qué build sirve una pestaña sin abrir DevTools. */
declare const __APP_BUILD__: string
