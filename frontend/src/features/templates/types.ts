import type { ApiSchemas, Delivered } from '../../shared/http/contract'


/** Una plantilla tal como la entrega el backend (contrato `TemplateItem`). */
export type ContractMessageTemplate = Delivered<ApiSchemas['TemplateItem']>

/**
 * Una plantilla. Sale del contrato con sus campos JSON refinados en la
 * frontera (`toMessageTemplate`): los botones oficiales y la configuración
 * interactiva los guarda el backend como JSON que valida al crearlos.
 */
export type MessageTemplate = Omit<ContractMessageTemplate, 'official_buttons' | 'interactive_config'> & {
  official_buttons: OfficialTemplateButton[]
  interactive_config: TemplateInteractiveConfig
}

export interface OfficialTemplateButton {
  type: 'quick_reply' | 'url' | 'phone_number'
  text: string
  url?: string
  phone_number?: string
}

/** Plantilla tal cual la devuelve la Graph API (`GET /{waba_id}/message_templates`),
 * antes de vincularla a la app -- ver `useMetaTemplates`. */
/** Un componente de una plantilla de Meta (encabezado, cuerpo, pie, botones). */
export interface MetaTemplateComponent {
  type: string
  format?: string
  text?: string
  buttons?: { type: string; text: string; url?: string; phone_number?: string }[]
}

/** Una plantilla tal como la devuelve Meta (contrato `MetaTemplateRaw`). El
 * contrato admite campos extra de Meta; se usan los declarados, y los
 * componentes, que son JSON de Meta, reciben su forma en la frontera. */
export type ContractMetaTemplate = Delivered<ApiSchemas['MetaTemplateRaw']>

export type MetaTemplateRaw = Pick<ContractMetaTemplate, 'id' | 'name' | 'status' | 'category' | 'language' | 'rejected_reason'> & {
  components: MetaTemplateComponent[] | null
}

/** Subtipo interactivo de una plantilla del CRM: el literal de Meta. */
export type TemplateInteractiveType = 'none' | 'button' | 'list'

export interface InteractiveReplyButton {
  type: 'reply'
  reply: { id: string; title: string }
}

export interface InteractiveListRow {
  id: string
  title: string
  description?: string
}

export interface InteractiveListSection {
  title?: string
  rows: InteractiveListRow[]
}

/** Objeto `interactive` de Meta sin `type` ni `body`: así se guarda en la
 * plantilla (el cuerpo sale del texto y el subtipo de `interactive_type`). */
export interface TemplateInteractiveConfig {
  header?: { type: 'text'; text: string }
  footer?: { text: string }
  action?: {
    buttons?: InteractiveReplyButton[]
    button?: string
    sections?: InteractiveListSection[]
  }
}

export type TemplateCapabilities = ApiSchemas['TemplateCapabilities']

export type InteractiveLimits = ApiSchemas['InteractiveLimits']

export interface TemplateAttachment {
  id: number
  media_url: string
  content_type: string
  filename: string
  position: number
  library_asset_id: number | null
}

export interface TemplateInput {
  name: string
  content: string
  shortcut: string | null
  category: string
  stage: MessageTemplate['stage']
  task_type: MessageTemplate['task_type']
  service: string | null
  template_type: MessageTemplate['template_type']
  official_name: string | null
  official_language: string | null
  official_category: MessageTemplate['official_category']
  official_status?: MessageTemplate['official_status']
  official_parameter_values: string[]
  official_header_type: MessageTemplate['official_header_type']
  official_header_text: string | null
  official_header_media_asset_id: number | null
  official_footer: string | null
  official_buttons: MessageTemplate['official_buttons']
  interactive_type: MessageTemplate['interactive_type']
  interactive_config: MessageTemplate['interactive_config']
}

export interface TemplateCategory {
  id: number
  name: string
  is_active?: boolean
  created_by_user_id?: number | null
  created_by_name?: string | null
  created_at?: string | null
}
