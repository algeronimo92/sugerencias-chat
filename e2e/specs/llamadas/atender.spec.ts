import type { ApiResponse } from '../../../frontend/src/shared/http/contract'
import { ADMIN } from '../../fixtures/crm'
import { expectFullyOnScreen, expectNoPageOverflow } from '../../fixtures/screen'
import { expect, test } from '../../fixtures/test'

type Call = ApiResponse<'/api/calls/ringing', 'get'>[number]

const LLAMADA: Call = {
  id: 7, chat_id: '11111111-1111-1111-1111-111111111111', direction: 'inbound', status: 'ringing', cause: null,
  cause_label: null, cause_group: null, error_code: null, ringing_at: new Date().toISOString(), accepted_at: null,
  ended_at: null, duration_seconds: null, handled_by_user_id: null, handled_by_name: null, caller_name: 'Josefina',
}

const ATENDIDA: Call = { ...LLAMADA, status: 'accepted', handled_by_user_id: ADMIN.id }

// El audio real va contra Meta: acá la conexión se reemplaza por una que
// "conecta" sola. Lo que se prueba es la pantalla y lo que se le pide al backend.
// Como el navegador de verdad, avisa la pista del cliente (`track`) al
// aplicar la oferta: antes de que el CRM reciba la conexión y pueda escuchar.
const CONEXION_FALSA = `
  class FakeConnection extends EventTarget {
    connectionState = 'new'; iceGatheringState = 'complete'; localDescription = null; remote = null
    addTrack() {}
    getReceivers() { return this.remote ? [{ track: this.remote }] : [] }
    async setRemoteDescription() {
      this.remote = new AudioContext().createMediaStreamDestination().stream.getAudioTracks()[0]
      this.dispatchEvent(new Event('track'))
    }
    async createAnswer() { return { type: 'answer', sdp: 'v=0\\r\\na=setup:active\\r\\n' } }
    async setLocalDescription(description) {
      this.localDescription = description
      setTimeout(() => { this.connectionState = 'connected'; this.dispatchEvent(new Event('connectionstatechange')) }, 300)
    }
    close() {}
  }
  window.RTCPeerConnection = FakeConnection
`

test.use({ permissions: ['microphone'], launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] } })

test('una llamada entrante suena, se atiende, se silencia y se cuelga', async ({ page, api }) => {
  let sonando = true
  api
    .on('get', '/api/auth/me', { ...ADMIN, can_handle_calls: true })
    .on('get', '/api/calls/ringing', () => (sonando ? [LLAMADA] : []))
    .on('get', '/api/calls/{call_id}/offer', { call_id: 7, sdp: 'v=0\r\na=setup:actpass\r\n' })
    .on('post', '/api/calls/{call_id}/accept', () => { sonando = false; return ATENDIDA })
    .on('post', '/api/calls/{call_id}/connected', ATENDIDA)
    .on('post', '/api/calls/{call_id}/terminate', { ...ATENDIDA, status: 'completed' })
  await page.addInitScript(CONEXION_FALSA)

  await page.goto('/')

  const entrante = page.getByRole('alertdialog', { name: 'Llamada entrante de Josefina' })
  await expectFullyOnScreen(entrante)
  await expectFullyOnScreen(entrante.getByRole('button', { name: 'Atender' }))
  await expectFullyOnScreen(entrante.getByRole('button', { name: 'Ignorar' }))
  await expectNoPageOverflow(page)

  await entrante.getByRole('button', { name: 'Atender' }).click()

  const enCurso = page.getByRole('region', { name: 'Llamada con Josefina' })
  await expectFullyOnScreen(enCurso)
  await expect(enCurso.getByRole('button', { name: 'Silenciar' })).toBeEnabled()
  expect(api.calls('post', '/api/calls/{call_id}/accept')[0].body).toMatchObject({ sdp: expect.stringContaining('v=0'), pre_accept: false })
  // Las primeras llamadas reales conectaban sin que se oyera al cliente: su
  // audio nunca llegaba al parlante.
  await expect.poll(() => page.evaluate(() => document.querySelector('audio')?.srcObject instanceof MediaStream)).toBe(true)

  await enCurso.getByRole('button', { name: 'Silenciar' }).click()
  await expect(enCurso.getByText('Micrófono apagado')).toBeVisible()

  await expectFullyOnScreen(enCurso.getByRole('button', { name: 'Colgar' }))
  await enCurso.getByRole('button', { name: 'Colgar' }).click()
  await expect(page.getByText(/Llamada terminada/)).toBeVisible()
  await expect.poll(() => api.calls('post', '/api/calls/{call_id}/terminate').length).toBe(1)
})

test('sin el permiso de llamadas no suena ni se consulta', async ({ page, api }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Conversaciones', level: 1 })).toBeVisible()

  await expect(page.getByRole('alertdialog')).toHaveCount(0)
  expect(api.calls('get', '/api/calls/ringing')).toEqual([])
})
