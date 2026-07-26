// defineConfig sale de vitest/config, no de vite: el de Vite no conoce la
// clave `test` y tsc la rechaza como propiedad desconocida.
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
