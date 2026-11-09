import { toast } from 'sonner'
import { extractErrorMessage } from '../../../shared/utils/errors'
import { useImportKnowledgePdf } from '../queries'

/** Mismo tope que el servidor (knowledge_service.MAX_CONTENT_LENGTH). */
export const MAX_CONTENT = 100_000

async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ''
  // Por tramos: String.fromCharCode con un PDF entero desborda la pila.
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  }
  return btoa(binary)
}

const TRUNCATED = 'El archivo era más largo que el máximo de 100.000 caracteres: se cortó al final.'

/**
 * Importar un PDF (lo lee el servidor) o un .txt/.md (se lee acá) al editor
 * de conocimiento. El texto se recorta al tope con aviso: antes un .txt de
 * 200.000 caracteres entraba entero, "Guardar" quedaba habilitado y fallaba
 * con un error genérico.
 */
export function useKnowledgeImport(apply: (content: string, suggestedTitle: string) => void) {
  const importPdf = useImportKnowledgePdf()

  async function importFile(file: File) {
    if (/\.pdf$/i.test(file.name) || file.type === 'application/pdf') {
      importPdf.mutate({ filename: file.name, dataBase64: await fileToBase64(file) }, {
        onSuccess: result => {
          apply(result.content, result.title)
          toast.success(
            `Texto de ${result.pages} ${result.pages === 1 ? 'página' : 'páginas'} importado. Revísalo antes de guardar.`,
            result.truncated ? { description: TRUNCATED } : undefined,
          )
        },
        onError: err => toast.error(extractErrorMessage(err)),
      })
      return
    }
    const text = await file.text()
    apply(text.slice(0, MAX_CONTENT), file.name.replace(/\.[^.]+$/, ''))
    toast.success('Texto importado. Revísalo antes de guardar.', text.length > MAX_CONTENT ? { description: TRUNCATED } : undefined)
  }

  return { importFile, isPending: importPdf.isPending }
}
