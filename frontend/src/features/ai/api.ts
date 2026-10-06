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

export async function fetchSuggestionStatus(chatId: string | null) {
      const { data } = await client.get<SuggestionStatus>(
        `/api/suggestions/${encodeURIComponent(chatId as string)}`,
      )
      return data
    }

export async function analyzeLead(chatId: string) {
      try {
        const { data } = await client.post<LeadAnalysisResult>('/api/suggestions/analyze', { chat_id: chatId })
        return data
      } catch (err) {
        throw toSuggestionError(err)
      }
    }

export async function generateSpeech(text: string): Promise<TtsResult> {
  const { data } = await client.post<{ content_type: string; data_base64: string }>('/api/tts', { text })
  return { contentType: data.content_type, dataBase64: data.data_base64 }
}

export async function fetchAiUsage() {
  return (await client.get<AIUsage>('/api/suggestions/usage')).data
}

export async function fetchAiProfile() {
  return (await client.get<AIProfile>('/api/ai/profile')).data
}

export async function saveAiProfile(profile: Omit<AIProfile, 'updated_at'>) {
  return (await client.put<AIProfile>('/api/ai/profile', profile)).data
}

export async function fetchKnowledgeDocuments() {
  return (await client.get<KnowledgeDocumentSummary[]>('/api/ai/knowledge')).data
}

export async function fetchKnowledgeDocument(id: string | null) {
  return (await client.get<KnowledgeDocument>(`/api/ai/knowledge/${id}`)).data
}

export async function saveKnowledgeDocument({ id, title, content }: { id: string | null; title: string; content: string }) {
  return id
        ? (await client.put<KnowledgeDocument>(`/api/ai/knowledge/${id}`, { title, content })).data
        : (await client.post<KnowledgeDocument>('/api/ai/knowledge', { title, content })).data
}

export async function deleteKnowledgeDocument(id: string) { await client.delete(`/api/ai/knowledge/${id}`) }

export async function setAiResourceDescription({ id, description }: { id: number; description: string }) {
  return (await client.patch<MediaAsset>(`/api/ai/resources/${id}`, { ai_description: description })).data
}
