import { toSuggestionError } from './errors'
import client from "../../shared/http/client";
import type { ApiResponse, UntypedResponse } from '../../shared/http/contract'
import type { SuggestionResponse, SuggestionStatus } from "../chats/types";
import type { MediaAsset } from "../media/types";
import type { AIProfile, AIUsage, GenerateParams, KnowledgeDocument, KnowledgeDocumentSummary, LeadAnalysisResult, TtsResult } from "./types";

export async function generateSuggestions(params: GenerateParams): Promise<SuggestionResponse> {
  try {
    const { data } = await client.post<ApiResponse<'/api/suggestions', 'post'>>('/api/suggestions', params)
    return data
  } catch (err) {
    throw toSuggestionError(err)
  }
}

export async function fetchSuggestionStatus(chatId: string | null): Promise<SuggestionStatus> {
  const { data } = await client.get<ApiResponse<'/api/suggestions/{chat_id}', 'get'>>(
    `/api/suggestions/${encodeURIComponent(chatId as string)}`,
  )
  return data
}

export async function analyzeLead(chatId: string): Promise<LeadAnalysisResult> {
  try {
    const { data } = await client.post<UntypedResponse<'/api/suggestions/analyze', 'post', LeadAnalysisResult>>('/api/suggestions/analyze', { chat_id: chatId })
    return data
  } catch (err) {
    throw toSuggestionError(err)
  }
}

export async function generateSpeech(text: string): Promise<TtsResult> {
  const { data } = await client.post<ApiResponse<'/api/tts', 'post'>>('/api/tts', { text })
  return { contentType: data.content_type, dataBase64: data.data_base64 }
}

export async function fetchAiUsage(): Promise<AIUsage> {
  return (await client.get<UntypedResponse<'/api/suggestions/usage', 'get', AIUsage>>('/api/suggestions/usage')).data
}

export async function fetchAiProfile(): Promise<AIProfile> {
  return (await client.get<ApiResponse<'/api/ai/profile', 'get'>>('/api/ai/profile')).data
}

export async function saveAiProfile(profile: Omit<AIProfile, 'updated_at'>): Promise<AIProfile> {
  return (await client.put<ApiResponse<'/api/ai/profile', 'put'>>('/api/ai/profile', profile)).data
}

export async function fetchKnowledgeDocuments(): Promise<KnowledgeDocumentSummary[]> {
  return (await client.get<ApiResponse<'/api/ai/knowledge', 'get'>>('/api/ai/knowledge')).data
}

export async function fetchKnowledgeDocument(id: string | null): Promise<KnowledgeDocument> {
  return (await client.get<ApiResponse<'/api/ai/knowledge/{document_id}', 'get'>>(`/api/ai/knowledge/${id}`)).data
}

export async function saveKnowledgeDocument({ id, title, content }: { id: string | null; title: string; content: string }) {
  return id
        ? (await client.put<ApiResponse<'/api/ai/knowledge/{document_id}', 'put'>>(`/api/ai/knowledge/${id}`, { title, content })).data
        : (await client.post<ApiResponse<'/api/ai/knowledge', 'post'>>('/api/ai/knowledge', { title, content })).data
}

export async function deleteKnowledgeDocument(id: string) { await client.delete<ApiResponse<'/api/ai/knowledge/{document_id}', 'delete'>>(`/api/ai/knowledge/${id}`) }

export async function setAiResourceDescription({ id, description }: { id: number; description: string }): Promise<MediaAsset> {
  return (await client.patch<ApiResponse<'/api/ai/resources/{asset_id}', 'patch'>>(`/api/ai/resources/${id}`, { ai_description: description })).data
}
