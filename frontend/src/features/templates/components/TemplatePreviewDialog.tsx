import { Eye } from 'lucide-react'
import { useMemo } from 'react'
import { Modal } from '../../../shared/ui/Modal'
import { useMediaLibrary } from '../../media/public/queries'
import { draftFromSaved } from '../domain/attachmentDraft'
import { formFromTemplate } from '../domain/templateDraft'
import { useTemplateCapabilities } from '../hooks/useTemplates'
import type { MessageTemplate } from '../types'
import { TemplatePreview } from './editor/TemplatePreview'

/**
 * La vista previa de una plantilla guardada, sin entrar al editor
 * (2026-11-24). Arranca en «Chat del lead»: desde la lista se busca cuál
 * mandar, y lo que interesa es cómo queda en la conversación.
 */
export function TemplatePreviewDialog({ template, onClose }: { template: MessageTemplate; onClose: () => void }) {
  const form = useMemo(() => formFromTemplate(template), [template])
  const attachments = useMemo(() => draftFromSaved(template.attachments), [template.attachments])
  const capabilities = useTemplateCapabilities()
  // De la biblioteca sale la imagen del encabezado de una oficial.
  const { data: mediaAssets = [] } = useMediaLibrary()

  return (
    <Modal title={template.name} icon={<Eye className="h-4 w-4" />} size="md" onClose={onClose}>
      <TemplatePreview
        form={form}
        attachments={attachments}
        mediaAssets={mediaAssets}
        defaultFooter={capabilities.data?.interactive_default_footer}
        initialView="chat"
      />
    </Modal>
  )
}
