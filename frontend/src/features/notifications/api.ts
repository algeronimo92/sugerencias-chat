import type {  } from './types'
import client from "../../shared/http/client";
import type { NotificationPage } from "../chats/types";
import type { VapidPublicKeyResponse } from './types';

export function requestNotificationHistory(unreadOnly: boolean, limit: number) {
  return async ({ pageParam }: { pageParam: number }) => (await client.get<NotificationPage>('/api/notifications', {
      params: { unread_only: unreadOnly, limit, offset: pageParam },
    })).data
}

export function requestMarkNotificationRead() {
  return async (id: number) => { await client.post(`/api/notifications/${id}/read`) }
}

export function requestMarkAllNotificationsRead() {
  return async () => { await client.post('/api/notifications/read-all') }
}

export async function fetchVapidPublicKey(): Promise<string> {
  const { data } = await client.get<VapidPublicKeyResponse>('/api/push/vapid-public-key')
  return data.public_key
}

export function postApiPushSubscribe0(subscription: PushSubscription) {
  return client.post('/api/push/subscribe', subscriptionPayload(subscription))
}

export function postApiPushUnsubscribe1(endpoint: string) {
  return client.post('/api/push/unsubscribe', { endpoint })
}

function subscriptionPayload(subscription: PushSubscription) {
  const json = subscription.toJSON()
  return {
    endpoint: json.endpoint,
    keys: { p256dh: json.keys?.p256dh, auth: json.keys?.auth },
  }
}
