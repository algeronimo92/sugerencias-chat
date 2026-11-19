import client from '../../shared/http/client'
import type { ApiResponse } from '../../shared/http/contract'
import type { Call } from './types'

export async function fetchRingingCalls(): Promise<Call[]> {
  const { data } = await client.get<ApiResponse<'/api/calls/ringing', 'get'>>('/api/calls/ringing')
  return data
}

export async function fetchChatCalls(chatId: string): Promise<Call[]> {
  const { data } = await client.get<ApiResponse<'/api/calls', 'get'>>('/api/calls', { params: { chat_id: chatId } })
  return data
}

/** La oferta de audio de Meta. Solo existe mientras la llamada suena. */
export async function fetchCallOffer(callId: number): Promise<string> {
  const { data } = await client.get<ApiResponse<'/api/calls/{call_id}/offer', 'get'>>(`/api/calls/${callId}/offer`)
  return data.sdp
}

export async function acceptCall(callId: number, payload: { sdp: string; client_id: string; pre_accept: boolean }): Promise<Call> {
  const { data } = await client.post<ApiResponse<'/api/calls/{call_id}/accept', 'post'>>(`/api/calls/${callId}/accept`, payload)
  return data
}

export async function confirmCallConnected(callId: number): Promise<Call> {
  const { data } = await client.post<ApiResponse<'/api/calls/{call_id}/connected', 'post'>>(`/api/calls/${callId}/connected`)
  return data
}

export async function dismissCall(callId: number): Promise<Call> {
  const { data } = await client.post<ApiResponse<'/api/calls/{call_id}/dismiss', 'post'>>(`/api/calls/${callId}/dismiss`)
  return data
}

export async function terminateCall(callId: number, cause: string | null): Promise<Call> {
  const { data } = await client.post<ApiResponse<'/api/calls/{call_id}/terminate', 'post'>>(`/api/calls/${callId}/terminate`, { cause })
  return data
}
