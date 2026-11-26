import type { ApiResponse } from '../../../frontend/src/shared/http/contract'
import { ADMIN } from '../../fixtures/crm'
import { expectFullyOnScreen, expectNoPageOverflow } from '../../fixtures/screen'
import { expect, test } from '../../fixtures/test'

type Users = ApiResponse<'/api/users', 'get'>
type NoticeRoute = '/api/appointments/notices/{audience}'

const NOTICIAS = { enabled: false, template_id: null, parameters: [], fields: [], templates: [], preview: null }

const EQUIPO: Users = [
  { id: ADMIN.id, email: ADMIN.email, name: ADMIN.name, role: 'admin', is_active: true, invitation_pending: false, phone: null, can_handle_calls: false },
  { id: 2, email: 'ana@clinica.test', name: 'Ana', role: 'vendedor', is_active: true, invitation_pending: false, phone: null, can_handle_calls: true },
  { id: 3, email: 'caro@clinica.test', name: 'Caro', role: 'analista', is_active: true, invitation_pending: false, phone: null, can_handle_calls: false },
]

test('con el número en la app de WhatsApp Business, la admin ve que hay que mudarlo y elige quién atiende', async ({ page, api }) => {
  api
    .on('get', '/api/whatsapp/calling-readiness', {
      state: 'requires_migration', on_business_app: true, messaging_limit: 'TIER_2K', messaging_limit_ok: true,
    })
    .on('get', '/api/users', EQUIPO)
    .on('patch', '/api/users/{user_id}', { ...EQUIPO[0], can_handle_calls: true })
    // Las otras tarjetas de Integraciones no son el tema: sin conectar.
    .on('get', '/api/settings', [])
    .on('get', '/api/settings/google-calendar/status', {
      oauth_available: false, connected: false, account_email: null, calendar_id: null, enabled: false, business_timezone: 'America/Lima',
    })
    .on('get', '/api/services/erp-sync', { configured: false, url: null, synced_at: null, last_error: null, last_summary: null })
    // Las tarjetas de abajo no se prueban acá: responden vacías.
    .on('get', '/api/appointments/notice-sender', { phone_number_id: null, numbers: [], account: null, templates: [] })
    // Literales: el simulador solo reemplaza parámetros numéricos de la ruta.
    .on('get', '/api/appointments/notices/client' as NoticeRoute, NOTICIAS)
    .on('get', '/api/appointments/notices/staff' as NoticeRoute, NOTICIAS)
    .on('get', '/api/appointments/reminders', {
      include_manual_events: false, reminders: [], fields: [], templates: [], preview: null,
      calendar_ready: false, sender_ready: false, recent: [],
    })
    .on('get', '/api/settings/email', {
      configured: false, mode: null, oauth_provider: null, oauth_account_email: null, oauth_available: [], platform_available: false,
      host: '', port: 587, security: 'starttls', username: '', password_configured: false, from_address: '', from_name: '',
    })
    .on('get', '/api/settings/meta/public-config', { app_id: null, config_id: null })
    .on('get', '/api/whatsapp/conversions', {
      enabled: false, accepted_by: null, accepted_at: null, dataset_id: null, test_event_code: null, days: 30,
      events: [], last_error: null, leads_total: 0, leads_with_click: 0,
    })
    .on('get', '/api/whatsapp/costs', {
      month: '2026-11', currency: 'USD', total_cost: 0, billed_messages: 0, free_messages: 0,
      free_service_used: 0, free_service_limit: 1000, accounts: [], breakdown: [], days: [], last_synced_at: null,
    })
    .on('get', '/api/ai/providers', {
      providers: [], primary_model: '', fallback_model: '', ready: false, model_params: {}, primary_params: {}, fallback_params: {},
    })

  await page.goto('/integraciones#whatsapp')

  const seccion = page.getByRole('region', { name: 'Llamadas de WhatsApp' })
  const aviso = seccion.getByRole('status').filter({ hasText: 'hay que mudar el número' })
  await aviso.scrollIntoViewIfNeeded()
  await expectFullyOnScreen(aviso.getByText('Para atender llamadas desde el CRM hay que mudar el número'))
  await expect(aviso).toContainText('no se puede deshacer')
  await expectNoPageOverflow(page)

  // La analista no aparece: solo ve el dashboard.
  await expect(seccion.getByRole('switch', { name: 'Caro atiende llamadas' })).toHaveCount(0)
  await expect(seccion.getByRole('switch', { name: 'Ana atiende llamadas' })).toHaveAttribute('aria-checked', 'true')

  const admin = seccion.getByRole('switch', { name: `${ADMIN.name} atiende llamadas` })
  await admin.scrollIntoViewIfNeeded()
  await expectFullyOnScreen(admin)
  await admin.click()
  await expect.poll(() => api.calls('patch', '/api/users/{user_id}').map((call) => call.body)).toEqual([{ can_handle_calls: true }])
})
