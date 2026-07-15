import { useMutation, useQuery } from '@tanstack/react-query'
import client from '../api/client'
import { queryClient } from '../queryClient'
import type { MediaAsset, MediaAssetKind } from '../types'

export interface MediaAssetUpload {
  contentType: string
  dataBase64: string
  filename: string
}

export function useMediaLibrary(search = '', kind: MediaAssetKind | '' = '') {
  return useQuery({
    queryKey: ['media-library', search, kind],
    queryFn: async () => (await client.get<MediaAsset[]>('/api/media-library', {
      params: { search: search || undefined, kind: kind || undefined },
    })).data,
  })
}

export function useUploadMediaAsset() {
  return useMutation({
    mutationFn: async (input: MediaAssetUpload) => (await client.post<MediaAsset>('/api/media-library', {
      content_type: input.contentType,
      data_base64: input.dataBase64,
      filename: input.filename,
    })).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['media-library'] }),
  })
}

export function useDeleteMediaAsset() {
  return useMutation({
    mutationFn: async (id: number) => { await client.delete(`/api/media-library/${id}`) },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['media-library'] }),
  })
}
