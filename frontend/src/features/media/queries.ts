import { useMutation,useQuery } from '@tanstack/react-query'
import { queryClient } from '../../shared/queryClient'
import { deleteMediaAsset,fetchMediaLibrary,renameMediaAsset,saveStickerToLibrary,uploadMediaAsset } from './api'
import type { MediaAsset,MediaAssetKind } from './types'

export type { MediaAssetUpload } from './types'

export function useMediaLibrary(search = '', kind: MediaAssetKind | '' = '') {
  return useQuery({
    queryKey: ['media-library', search, kind],
    queryFn: () => fetchMediaLibrary(search, kind),
  })
}

export function useUploadMediaAsset() {
  return useMutation({
    mutationFn: uploadMediaAsset,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['media-library'] }),
  })
}

/** Guarda un sticker que aparece en un chat en la librería (para reenviarlo),
 * como el "agregar a favoritos" de WhatsApp. */
export function useSaveStickerToLibrary() {
  return useMutation({
    mutationFn: saveStickerToLibrary,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['media-library'] }),
  })
}

export function useRenameMediaAsset() {
  return useMutation({
    mutationFn: renameMediaAsset,
    onSuccess: () => Promise.all([
      queryClient.invalidateQueries({ queryKey: ['media-library'] }),
      queryClient.invalidateQueries({ queryKey: ['templates'] }),
    ]),
  })
}

export function useDeleteMediaAsset() {
  return useMutation({
    mutationFn: deleteMediaAsset,
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: ['media-library'] })
      const previous = queryClient.getQueriesData<MediaAsset[]>({ queryKey: ['media-library'] })
      queryClient.setQueriesData<MediaAsset[]>({ queryKey: ['media-library'] }, current =>
        current?.filter(asset => asset.id !== id),
      )
      return { previous }
    },
    onError: (_error, _id, context) => {
      context?.previous.forEach(([queryKey, data]) => queryClient.setQueryData(queryKey, data))
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['media-library'] }),
  })
}
