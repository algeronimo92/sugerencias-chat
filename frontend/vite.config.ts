// defineConfig sale de vitest/config, no de vite: el de Vite no conoce la
// clave `test` y tsc la rechaza como propiedad desconocida.
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // El service worker es lo que convierte a la app en instalable de verdad:
    // sin él Chrome Android no ofrece "Instalar" ni genera el WebAPK, solo un
    // acceso directo. Precachea el shell (JS/CSS/íconos), nunca datos.
    VitePWA({
      // 'prompt' y no 'autoUpdate': recargar solo mientras alguien escribe un
      // mensaje le borraría el borrador. El usuario decide cuándo aplicar.
      registerType: 'prompt',
      // El manifest vive en public/manifest.webmanifest y ya está enlazado
      // desde index.html; el plugin solo se ocupa del service worker.
      manifest: false,
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // Las rutas del CRM son del router de React, así que cualquier
        // navegación cae al shell. La denylist es crítica: sin ella el SW
        // respondería index.html a las llamadas de API y a los archivos
        // multimedia servidos por el backend.
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/media\//, /^\/ws\//],
        cleanupOutdatedCaches: true,
      },
      // El multimedia de los clientes es contenido privado: no se cachea en
      // el SW a propósito, queda solo en la caché HTTP del navegador.
      devOptions: { enabled: false },
    }),
  ],
  test: {
    // jsdom y no el entorno node por defecto: los tests montan componentes y
    // hooks que necesitan DOM, localStorage y WebSocket.
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    globals: true,
    // Storybook trae sus propios archivos *.stories.tsx; no son tests.
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    css: false,
  },
})
