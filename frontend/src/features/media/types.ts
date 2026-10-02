
export type MediaAssetKind = 'image' | 'video' | 'audio' | 'document'

export interface MediaAsset {
  id: number
  media_url: string
  content_type: string
  filename: string
  size_bytes: number
  uploaded_by_user_id: number | null
  uploaded_by_name: string | null
  created_at: string
  use_count: number
  ai_description?: string | null
}

export interface MediaAssetUpload {
  contentType: string
  dataBase64: string
  filename: string
}
