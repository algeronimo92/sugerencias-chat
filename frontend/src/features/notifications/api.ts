import client from "../../shared/http/client";
import type { ApiResponse } from '../../shared/http/contract'
import type { NotificationPage } from "../chats/types";

export async function fetchNotificationHistory(unreadOnly: boolean, limit: number, offset: number): Promise<NotificationPage> {
  return (await client.get<ApiResponse<'/api/notifications', 'get'>>('/api/notifications', {
      params: { unread_only: unreadOnly, limit, offset },
    })).data
}

export async function markNotificationRead(id: number) { await client.post<ApiResponse<'/api/notifications/{notification_id}/read', 'post'>>(`/api/notifications/${id}/read`) }

export async function markAllNotificationsRead() { await client.post<ApiResponse<'/api/notifications/read-all', 'post'>>('/api/notifications/read-all') }

export async function fetchVapidPublicKey(): Promise<string> {
  const { data } = await client.get<ApiResponse<'/api/push/vapid-public-key', 'get'>>('/api/push/vapid-public-key')
  return data.public_key
}

export async function subscribePush(subscription: PushSubscription) {
  return (await client.post<ApiResponse<'/api/push/subscribe', 'post'>>('/api/push/subscribe', subscriptionPayload(subscription))).data
}

export async function unsubscribePush(endpoint: string) {
  return (await client.post<ApiResponse<'/api/push/unsubscribe', 'post'>>('/api/push/unsubscribe', { endpoint })).data
}

function subscriptionPayload(subscription: PushSubscription) {
  const json = subscription.toJSON()
  return {
    endpoint: json.endpoint,
    keys: { p256dh: json.keys?.p256dh, auth: json.keys?.auth },
  }
}
