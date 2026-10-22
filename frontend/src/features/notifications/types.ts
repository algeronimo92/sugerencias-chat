import type { JsonObject } from '../../shared/types'
import type { NotificationTypeValue } from '../automations/public/automationCatalog'


export interface VapidPublicKeyResponse {
  public_key: string
}

export interface UserNotification {
  id: number
  notification_type: NotificationTypeValue
  title: string
  body: string
  lead_id: string | null
  source_id: string | null
  metadata: JsonObject | null
  read_at: string | null
  created_at: string
}

export interface NotificationPage {
  items: UserNotification[]
  unread_count: number
  has_more: boolean
}
