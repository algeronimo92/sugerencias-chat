import type { ApiResponse } from '../../frontend/src/shared/http/contract'
import type { MockApi } from './api'

type Chat = ApiResponse<'/api/chats/{chat_id}', 'get'>
type User = ApiResponse<'/api/auth/me', 'get'>
type Message = ApiResponse<'/api/chats/{chat_id}/messages', 'post'>
type Flow = ApiResponse<'/api/automations/manual', 'get'>[number]
type Execution = ApiResponse<'/api/automations/{rule_id}/start', 'post'>

export const ADMIN: User = { id: 1, email: 'admin@clinica.test', name: 'Admin', role: 'admin' }

export const CHAT_ID = '51999000111'

export function chat(overrides: Partial<Chat> = {}): Chat {
  return {
    chat_id: CHAT_ID,
    phone: CHAT_ID,
    secondary_phone: null,
    username: null,
    name: 'Josefina Paredes',
    servicio_interes: 'HIFU 12D',
    vendedor_id: ADMIN.id,
    vendedor: ADMIN.name,
    origen: null,
    notas: null,
    stage: 'nuevo',
    con_especialista: false,
    automatizacion_pausada: false,
    conversacion_abierta: true,
    conversacion_abierta_at: '2026-11-10T15:00:00Z',
    conversacion_cerrada_at: null,
    conversacion_version: 1,
    razon_perdido: null,
    fecha_recontacto: null,
    proxima_cita: null,
    contador_noshow: 0,
    toques_seguimiento: 0,
    fecha_ultimo_toque: null,
    last_message: 'Hola, quiero información',
    last_message_sender: 'customer',
    last_message_type: 'text',
    last_message_subtype: null,
    last_message_deleted: false,
    timestamp: '2026-11-10T15:00:00Z',
    last_customer_message_at: '2026-11-10T15:00:00Z',
    unread_count: 0,
    last_read_at: '2026-11-10T15:00:00Z',
    last_automated_reply_at: null,
    tags: [],
    search_rank: 0,
    matched_message: null,
    matched_message_id: null,
    ...overrides,
  }
}

let nextMessageId = 100

export function message(overrides: Partial<Message> = {}): Message {
  nextMessageId += 1
  return {
    id: nextMessageId,
    sender: 'customer',
    direction: 'inbound',
    content: 'Hola, quiero información',
    // Relativo a ahora: con una fecha fija el separador de día ("Hoy",
    // "Ayer", la fecha) cambiaría según cuándo corra la prueba.
    sent_at: new Date(Date.now() - 5 * 60_000).toISOString(),
    media_url: null,
    wa_message_id: `wamid.${nextMessageId}`,
    outbox_status: null,
    meta_status: null,
    status_payload: null,
    message_type: 'text',
    message_subtype: null,
    provider_payload: null,
    analysis: null,
    payload: null,
    reactions: [],
    edited_at: null,
    deleted_at: null,
    media_width: null,
    media_height: null,
    quoted_message_id: null,
    quoted_sender: null,
    quoted_content: null,
    quoted_message_type: null,
    pinned_at: null,
    error_detail: null,
    origin: null,
    ...overrides,
  }
}

export function sentMessage(content: string, overrides: Partial<Message> = {}): Message {
  return message({
    sender: 'agent',
    direction: 'outbound',
    content,
    outbox_status: 'sent',
    meta_status: 'delivered',
    origin: { kind: 'user', user_id: ADMIN.id, user_name: ADMIN.name, execution_id: null },
    ...overrides,
  })
}

/** Un flujo manual como los que lista "Iniciar flujo". Los nombres largos son
 *  a propósito: son los que se cortaban en el celular. */
export function flow(id: number, name: string): Flow {
  return {
    id,
    name,
    trigger_type: 'manual',
    trigger_config: {},
    conditions: {},
    actions: [],
    builder_mode: 'visual',
    flow_definition: {},
    published_flow_definition: {},
    flow_version: 1,
    delay_minutes: 0,
    max_executions_per_hour: null,
    is_active: true,
    visible_to_sellers: true,
    created_by_user_id: ADMIN.id,
    created_by_name: ADMIN.name,
    execution_count: 0,
    last_execution_at: null,
    last_execution_status: null,
    created_at: '2026-11-01T15:00:00Z',
    updated_at: '2026-11-01T15:00:00Z',
  }
}

export const FLOWS = [
  flow(1, 'Hollywood peel'),
  flow(2, 'Evidencia HP hombre'),
  flow(3, 'Precio hifu'),
  flow(4, 'Evidencia HP mujer'),
  flow(5, 'Ubicacion'),
]

export function execution(rule: Flow, overrides: Partial<Execution> = {}): Execution {
  return {
    id: 900 + rule.id,
    rule_id: rule.id,
    rule_name: rule.name,
    rule_deleted: false,
    parent_execution_id: null,
    parent_rule_id: null,
    parent_rule_name: null,
    lead_id: CHAT_ID,
    lead_name: 'Josefina Paredes',
    trigger_type: 'manual',
    status: 'scheduled',
    scheduled_for: new Date(Date.now() + 10 * 60_000).toISOString(),
    paused_at: null,
    pause_scope: null,
    started_at: new Date().toISOString(),
    finished_at: null,
    action_results: [],
    flow_state: {},
    error: null,
    error_code: null,
    created_at: new Date().toISOString(),
    start_source: 'manual',
    started_by_user_id: ADMIN.id,
    started_by_name: ADMIN.name,
    window_override_at: null,
    window_override_by_name: null,
    ...overrides,
  }
}

const INTERACTIVE_LIMITS = {
  text: 4096, body: 1024, title: 60, footer: 60, button_text: 20, button_id: 256, max_buttons: 3,
  list_button_text: 20, section_title: 24, row_title: 24, row_description: 72, row_id: 200,
  max_sections: 10, max_rows: 10,
}

/** Lo mínimo para que el CRM abra con sesión de admin y un chat en la lista. */
export function crmDefaults(api: MockApi) {
  const lead = chat()
  api
    .on('get', '/api/branding', { name: 'Clínica Demo', primary_color: '#00a884', logo_url: null, icon_url: null })
    .on('get', '/api/auth/me', ADMIN)
    .on('get', '/api/auth/pin/status', { available: false, user_name: null, masked_email: null, device_name: null, locked_seconds: 0 })
    .on('get', '/api/chats', { items: [lead], has_more: false, total: null })
    .on('get', '/api/chats/unread-count', { count: 0 })
    .on('get', '/api/chats/{chat_id}', lead)
    .on('get', '/api/notifications', { items: [], unread_count: 0, has_more: false })
    .on('get', '/api/onboarding', { steps: [], completed: 0, total: 0, all_done: true, dismissed: true })
    .on('get', '/api/push/vapid-public-key', { public_key: '' })
    .on('get', '/api/lead-stages', [
      { key: 'nuevo', name: 'Nuevo', color: '#3b82f6', position: 0, kind: 'open', is_active: true, description: null, is_system: true, on_appointment: false },
      { key: 'cita', name: 'Cita agendada', color: '#22c55e', position: 1, kind: 'open', is_active: true, description: null, is_system: true, on_appointment: true },
    ])
    .on('get', '/api/whatsapp/status', { state: 'open', instance: 'demo' })
    .on('get', '/api/templates', [])
    .on('get', '/api/templates/capabilities', {
      integration: 'meta', official_sending_supported: true, reason: null, interactive_limits: INTERACTIVE_LIMITS,
      interactive_default_footer: '', catalog_enabled: false, flows_enabled: false, call_permission_enabled: false,
      catalog_id: null, published_flows: [],
    })
    .on('get', '/api/automations/manual', FLOWS)
    .on('get', '/api/automations/executions', [])
    .on('get', '/api/chats/{chat_id}/messages', {
      items: [
        message(),
        sentMessage('Hola Josefina, para darte una recomendación personalizada necesito ver tu rostro. ¿Podrías enviarme una foto con buena luz?'),
      ],
      has_more: false,
    })
    .on('get', '/api/chats/{chat_id}/notes', [])
    .on('get', '/api/chats/{chat_id}/activity', [])
    .on('get', '/api/chats/{chat_id}/pinned-messages', { items: [] })
    .on('get', '/api/chats/{chat_id}/service-window', () => ({
      is_open: true,
      last_customer_message_at: new Date(Date.now() - 60_000).toISOString(),
      expires_at: new Date(Date.now() + 23 * 3_600_000).toISOString(),
      seconds_remaining: 23 * 3600,
      free_entry_point_open: false,
      free_entry_point_expires_at: null,
      ad_reply_deadline: null,
    }))
    .on('get', '/api/chats/sellers', [{ id: ADMIN.id, name: ADMIN.name, role: 'admin' }])
    .on('get', '/api/services', [
      { id: 1, name: 'HIFU 12D', is_active: true, packages: [], external_id: null, created_by_user_id: null, created_by_name: null, created_at: null },
    ])
    .on('get', '/api/custom-fields', [])
    .on('get', '/api/custom-fields/lead-values/{lead_id}', { values: {} })
    .on('get', '/api/ai/profile', {
      business_name: 'Clínica Demo', business_description: null, location: null, opening_hours: null,
      currency: 'PEN', tone: null, always_rules: null, never_rules: null, updated_at: null,
    })
    .on('get', '/api/suggestions/{chat_id}', { suggestion: null, generated_at: null, stale: false, unavailable: null })
}
