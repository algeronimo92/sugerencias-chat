import { useMutation,useQuery } from '@tanstack/react-query'
import { queryClient } from '../../shared/queryClient'
import { requestDeleteMediaAsset,requestMediaLibrary,requestRenameMediaAsset,requestSaveStickerToLibrary,requestUploadMediaAsset } from './api'
import type { MediaAsset,MediaAssetKind } from './types'

export type { MediaAssetUpload } from './types'

export function useMediaLibrary(search = '', kind: MediaAssetKind | '' = '') {
  return useQuery({
    queryKey: ['media-library', search, kind],
    queryFn: requestMediaLibrary(search, kind),
  })
}

export function useUploadMediaAsset() {
  return useMutation({
    mutationFn: requestUploadMediaAsset(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['media-library'] }),
  })
}

/** Guarda un sticker que aparece en un chat en la librería (para reenviarlo),
 * como el "agregar a favoritos" de WhatsApp. */
export function useSaveStickerToLibrary() {
  return useMutation({
    mutationFn: requestSaveStickerToLibrary(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['media-library'] }),
  })
}

export function useRenameMediaAsset() {
  return useMutation({
    mutationFn: requestRenameMediaAsset(),
    onSuccess: () => Promise.all([
      queryClient.invalidateQueries({ queryKey: ['media-library'] }),
      queryClient.invalidateQueries({ queryKey: ['templates'] }),
    ]),
  })
}

export function useDeleteMediaAsset() {
  return useMutation({
    mutationFn: requestDeleteMediaAsset(),
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
