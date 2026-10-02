import { toSuggestionError } from './errors'
import client from "../../shared/http/client";
import type { SuggestionResponse,SuggestionStatus } from "../chats/types";
import type { MediaAsset } from "../media/types";
import type { AIProfile,AIUsage,GenerateParams,KnowledgeDocument,KnowledgeDocumentSummary,LeadAnalysisResult,TtsResult } from "./types";

export async function generateSuggestions(params: GenerateParams): Promise<SuggestionResponse> {
  try {
    const { data } = await client.post<SuggestionResponse>('/api/suggestions', params)
    return data
  } catch (err) {
    throw toSuggestionError(err)
  }
}

export function requestSuggestionStatus(chatId: string | null) {
  return async () => {
      const { data } = await client.get<SuggestionStatus>(
        `/api/suggestions/${encodeURIComponent(chatId as string)}`,
      )
      return data
    }
}

export function requestAnalyzeLead() {
  return async (chatId: string) => {
      try {
        const { data } = await client.post<LeadAnalysisResult>('/api/suggestions/analyze', { chat_id: chatId })
        return data
      } catch (err) {
        throw toSuggestionError(err)
      }
    }
}

export async function generateSpeech(text: string): Promise<TtsResult> {
  const { data } = await client.post<{ content_type: string; data_base64: string }>('/api/tts', { text })
  return { contentType: data.content_type, dataBase64: data.data_base64 }
}

export function requestAiUsage() {
  return async () => (await client.get<AIUsage>('/api/suggestions/usage')).data
}

export function requestAiProfile() {
  return async () => (await client.get<AIProfile>('/api/ai/profile')).data
}

export function requestSaveAiProfile() {
  return async (profile: Omit<AIProfile, 'updated_at'>) =>
      (await client.put<AIProfile>('/api/ai/profile', profile)).data
}

export function requestKnowledgeDocuments() {
  return async () => (await client.get<KnowledgeDocumentSummary[]>('/api/ai/knowledge')).data
}

export function requestKnowledgeDocument(id: string | null) {
  return async () => (await client.get<KnowledgeDocument>(`/api/ai/knowledge/${id}`)).data
}

export function requestSaveKnowledgeDocument() {
  return async ({ id, title, content }: { id: string | null; title: string; content: string }) =>
      id
        ? (await client.put<KnowledgeDocument>(`/api/ai/knowledge/${id}`, { title, content })).data
        : (await client.post<KnowledgeDocument>('/api/ai/knowledge', { title, content })).data
}

export function requestDeleteKnowledgeDocument() {
  return async (id: string) => { await client.delete(`/api/ai/knowledge/${id}`) }
}

export function requestSetAiResourceDescription() {
  return async ({ id, description }: { id: number; description: string }) =>
      (await client.patch<MediaAsset>(`/api/ai/resources/${id}`, { ai_description: description })).data
}
