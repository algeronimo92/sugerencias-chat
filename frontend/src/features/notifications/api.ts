import client from "../../shared/http/client";
import type { NotificationPage } from "../chats/types";
import type { VapidPublicKeyResponse } from './types';

export async function fetchNotificationHistory(unreadOnly: boolean, limit: number, offset: number) {
  return (await client.get<NotificationPage>('/api/notifications', {
      params: { unread_only: unreadOnly, limit, offset },
    })).data
}

export async function markNotificationRead(id: number) { await client.post(`/api/notifications/${id}/read`) }

export async function markAllNotificationsRead() { await client.post('/api/notifications/read-all') }

export async function fetchVapidPublicKey(): Promise<string> {
  const { data } = await client.get<VapidPublicKeyResponse>('/api/push/vapid-public-key')
  return data.public_key
}

export async function subscribePush(subscription: PushSubscription) {
  return (await client.post('/api/push/subscribe', subscriptionPayload(subscription))).data
}

export async function unsubscribePush(endpoint: string) {
  return (await client.post('/api/push/unsubscribe', { endpoint })).data
}

function subscriptionPayload(subscription: PushSubscription) {
  const json = subscription.toJSON()
  return {
    endpoint: json.endpoint,
    keys: { p256dh: json.keys?.p256dh, auth: json.keys?.auth },
  }
}
