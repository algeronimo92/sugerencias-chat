import type { ApiResponse } from '../../../frontend/src/shared/http/contract'
import { ADMIN, chat } from '../../fixtures/crm'
import { expectFullyOnScreen } from '../../fixtures/screen'
import { expect, test } from '../../fixtures/test'

type Call = ApiResponse<'/api/calls', 'post'>

const LEAD = chat()
const SALIENTE: Call = {
  id: 9, chat_id: LEAD.chat_id, direction: 'outbound', status: 'dialing', cause: null, cause_label: null,
  cause_group: null, error_code: null, ringing_at: new Date().toISOString(), accepted_at: null, ended_at: null,
  duration_seconds: null, handled_by_user_id: ADMIN.id, handled_by_name: null, caller_name: null,
}

const CONEXION_FALSA = `
  class FakeConnection extends EventTarget {
    connectionState = 'new'; iceGatheringState = 'complete'; localDescription = null
    addTrack() {}
    async createOffer() { return { type: 'offer', sdp: 'v=0\\r\\na=setup:actpass\\r\\n' } }
    async setLocalDescription(description) { this.localDescription = description }
    async setRemoteDescription() {
      setTimeout(() => { this.connectionState = 'connected'; this.dispatchEvent(new Event('connectionstatechange')) }, 200)
    }
    close() {}
  }
  window.RTCPeerConnection = FakeConnection
`

test.use({ permissions: ['microphone'], launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] } })

test('con permiso del cliente, el botón Llamar inicia la llamada y conecta cuando contesta', async ({ page, api }) => {
  api
    .on('get', '/api/auth/me', { ...ADMIN, can_handle_calls: true })
    .on('get', '/api/calls/ringing', [])
    .on('get', '/api/calls/permission', { status: 'temporary', expires_at: '2026-11-25T15:00:00Z', can_call: true, can_request: false })
    .on('post', '/api/calls', SALIENTE)
    .on('get', '/api/calls/{call_id}/answer', { call: { ...SALIENTE, status: 'accepted' }, sdp: 'v=0\r\na=setup:active\r\n' })
    .on('post', '/api/calls/{call_id}/terminate', { ...SALIENTE, status: 'completed' })
  await page.addInitScript(CONEXION_FALSA)
  await page.addInitScript(() => localStorage.setItem('calls.devicePrepared', '1'))

  await page.goto(`/chat/${LEAD.chat_id}`)

  const llamar = page.getByRole('button', { name: /^Llamar\. Con permiso hasta el 25 nov/ })
  await expectFullyOnScreen(llamar)
  await llamar.click()

  const enCurso = page.getByRole('region', { name: /^Llamada con / })
  await expectFullyOnScreen(enCurso)
  await expect(enCurso.getByRole('button', { name: 'Silenciar' })).toBeEnabled()
  expect(api.calls('post', '/api/calls')[0].body).toMatchObject({ chat_id: LEAD.chat_id, sdp: expect.stringContaining('v=0') })

  await enCurso.getByRole('button', { name: 'Colgar' }).click()
  await expect(page.getByText(/Llamada terminada/)).toBeVisible()
})

test('sin permiso del cliente el botón no llama y dice por qué', async ({ page, api }) => {
  api
    .on('get', '/api/auth/me', { ...ADMIN, can_handle_calls: true })
    .on('get', '/api/calls/ringing', [])
    .on('get', '/api/calls/permission', { status: 'none', expires_at: null, can_call: false, can_request: true })
  await page.addInitScript(() => localStorage.setItem('calls.devicePrepared', '1'))

  await page.goto(`/chat/${LEAD.chat_id}`)

  const llamar = page.getByRole('button', { name: /todavía no dio permiso/ })
  await expectFullyOnScreen(llamar)
  await expect(llamar).toHaveAttribute('aria-disabled', 'true')
  await llamar.click({ force: true })
  expect(api.calls('post', '/api/calls')).toEqual([])
})
