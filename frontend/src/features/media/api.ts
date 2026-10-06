import client from "../../shared/http/client";
import type { MediaAsset,MediaAssetKind,MediaAssetUpload } from "./types";

export async function fetchMediaLibrary(search: string, kind: "" | MediaAssetKind) {
  return (await client.get<MediaAsset[]>('/api/media-library', {
      params: { search: search || undefined, kind: kind || undefined },
    })).data
}

export async function uploadMediaAsset(input: MediaAssetUpload) {
  return (await client.post<MediaAsset>('/api/media-library', {
      content_type: input.contentType,
      data_base64: input.dataBase64,
      filename: input.filename,
    })).data
}

export async function saveStickerToLibrary(mediaUrl: string) {
  return (await client.post<MediaAsset>('/api/media-library/from-sticker', {
      media_url: mediaUrl,
    })).data
}

export async function renameMediaAsset({ id, filename }: { id: number; filename: string }) {
  return (await client.patch<MediaAsset>(`/api/media-library/${id}`, { filename })).data
}

export async function deleteMediaAsset(id: number) { await client.delete(`/api/media-library/${id}`) }
