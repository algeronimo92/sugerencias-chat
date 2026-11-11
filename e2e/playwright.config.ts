import { defineConfig, devices } from '@playwright/test'

/**
 * Pruebas de pantalla: la app compilada, en un navegador real, con el backend
 * simulado en la red (fixtures/api.ts). Existen porque Vitest corre sobre
 * jsdom, que no calcula tamaños ni posiciones: un menú que se sale de la
 * pantalla o un cuadro de escritura tapado pasaban con CI en verde.
 *
 * No reemplazan a la suite de pila completa de
 * docs/analisis/04-plan-testing-playwright.md (backend, base y WhatsApp
 * reales): comparten carpeta y configuración para que esa se sume acá.
 */
const PORT = 4173

export default defineConfig({
  testDir: './specs',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    // El service worker de la PWA atendería los pedidos por su cuenta y el
    // backend simulado no los vería.
    serviceWorkers: 'block',
    locale: 'es-PE',
    timezoneId: 'America/Lima',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'escritorio', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    // Un Android angosto: es donde se cortaron el menú de flujos y la cabecera.
    { name: 'celular', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    // Se prueba el build de producción, no el servidor de desarrollo: es lo
    // que llega a los clientes. VITE_API_BASE_URL vacío = mismo origen.
    command: `npm run build && npm run preview -- --port ${PORT} --strictPort`,
    cwd: '../frontend',
    env: { VITE_API_BASE_URL: '' },
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
  },
})
