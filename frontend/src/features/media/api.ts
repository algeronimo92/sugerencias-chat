import client from "../../shared/http/client";
import type { ApiResponse } from '../../shared/http/contract'
import type { MediaAsset, MediaAssetKind, MediaAssetUpload } from "./types";

export async function fetchMediaLibrary(search: string, kind: "" | MediaAssetKind): Promise<MediaAsset[]> {
  return (await client.get<ApiResponse<'/api/media-library', 'get'>>('/api/media-library', {
      params: { search: search || undefined, kind: kind || undefined },
    })).data
}

export async function uploadMediaAsset(input: MediaAssetUpload): Promise<MediaAsset> {
  return (await client.post<ApiResponse<'/api/media-library', 'post'>>('/api/media-library', {
      content_type: input.contentType,
      data_base64: input.dataBase64,
      filename: input.filename,
    })).data
}

export async function saveStickerToLibrary(mediaUrl: string): Promise<MediaAsset> {
  return (await client.post<ApiResponse<'/api/media-library/from-sticker', 'post'>>('/api/media-library/from-sticker', {
      media_url: mediaUrl,
    })).data
}

export async function renameMediaAsset({ id, filename }: { id: number; filename: string }): Promise<MediaAsset> {
  return (await client.patch<ApiResponse<'/api/media-library/{asset_id}', 'patch'>>(`/api/media-library/${id}`, { filename })).data
}

export async function deleteMediaAsset(id: number) { await client.delete<ApiResponse<'/api/media-library/{asset_id}', 'delete'>>(`/api/media-library/${id}`) }
