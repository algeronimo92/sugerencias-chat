import { BookText } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useKnowledgeDocuments } from '../queries'

/**
 * En cada servicio de Catálogos: cuántos documentos tiene para la IA y el
 * atajo para verlos o subir su ficha. Vive en ``ai`` y Catálogos lo recibe
 * armado desde app/, porque catalogs es una capa inferior.
 */
export function ServiceKnowledgeLink({ serviceId, serviceName }: { serviceId: number; serviceName: string }) {
  const { data: documents = [] } = useKnowledgeDocuments()
  const count = documents.filter(document => document.service_ids.includes(serviceId)).length
  return (
    <Link
      to={`/ai-assistant?tab=knowledge&servicio=${serviceId}`}
      aria-label={`${count ? 'Ver' : 'Subir'} fichas para la IA de ${serviceName}`}
      // 24 px de alto para tocarlo bien; verde solo donde ya hay fichas, para
      // que 56 enlaces iguales no compitan con los que importan.
      className={`mt-2 inline-flex min-h-6 items-center gap-1.5 text-xs font-medium hover:underline ${count ? 'text-wa-primary-strong dark:text-wa-primary' : 'text-wa-muted dark:text-wa-muted-dark'}`}
    >
      <BookText className="h-3.5 w-3.5" aria-hidden="true" />
      {count ? `${count} ${count === 1 ? 'ficha' : 'fichas'} para la IA` : 'Subir ficha para la IA'}
    </Link>
  )
}
