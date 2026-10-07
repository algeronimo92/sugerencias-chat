import { useMutation, useQuery } from '@tanstack/react-query'
import { queryClient } from '../../shared/queryClient'
import { deleteMediaAsset, fetchMediaLibrary, renameMediaAsset, saveStickerToLibrary, uploadMediaAsset } from './api'
import type { MediaAsset, MediaAssetKind } from './types'
import { mediaKeys } from './keys'

export type { MediaAssetUpload } from './types'

export function useMediaLibrary(search = '', kind: MediaAssetKind | '' = '') {
  return useQuery({
    queryKey: mediaKeys.list(search, kind),
    queryFn: () => fetchMediaLibrary(search, kind),
  })
}

export function useUploadMediaAsset() {
  return useMutation({
    mutationFn: uploadMediaAsset,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: mediaKeys.all }),
  })
}

/** Guarda un sticker que aparece en un chat en la librería (para reenviarlo),
 * como el "agregar a favoritos" de WhatsApp. */
export function useSaveStickerToLibrary() {
  return useMutation({
    mutationFn: saveStickerToLibrary,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: mediaKeys.all }),
  })
}

export function useRenameMediaAsset() {
  return useMutation({
    mutationFn: renameMediaAsset,
    // Si el archivo era adjunto de plantillas, el backend avisa
    // templates_updated y las plantillas se refrescan solas.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: mediaKeys.all }),
  })
}

export function useDeleteMediaAsset() {
  return useMutation({
    mutationFn: deleteMediaAsset,
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: mediaKeys.all })
      const previous = queryClient.getQueriesData<MediaAsset[]>({ queryKey: mediaKeys.all })
      queryClient.setQueriesData<MediaAsset[]>({ queryKey: mediaKeys.all }, current =>
        current?.filter(asset => asset.id !== id),
      )
      return { previous }
    },
    onError: (_error, _id, context) => {
      context?.previous.forEach(([queryKey, data]) => queryClient.setQueryData(queryKey, data))
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: mediaKeys.all }),
  })
}
