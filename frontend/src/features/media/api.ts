import client from "../../shared/http/client";
import type { MediaAsset,MediaAssetKind,MediaAssetUpload } from "./types";

export function requestMediaLibrary(search: string, kind: "" | MediaAssetKind) {
  return async () => (await client.get<MediaAsset[]>('/api/media-library', {
      params: { search: search || undefined, kind: kind || undefined },
    })).data
}

export function requestUploadMediaAsset() {
  return async (input: MediaAssetUpload) => (await client.post<MediaAsset>('/api/media-library', {
      content_type: input.contentType,
      data_base64: input.dataBase64,
      filename: input.filename,
    })).data
}

export function requestSaveStickerToLibrary() {
  return async (mediaUrl: string) => (await client.post<MediaAsset>('/api/media-library/from-sticker', {
      media_url: mediaUrl,
    })).data
}

export function requestRenameMediaAsset() {
  return async ({ id, filename }: { id: number; filename: string }) =>
      (await client.patch<MediaAsset>(`/api/media-library/${id}`, { filename })).data
}

export function requestDeleteMediaAsset() {
  return async (id: number) => { await client.delete(`/api/media-library/${id}`) }
}
