import { Loader2 } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { extractErrorMessage } from '../../../shared/utils/errors'
import { useStartManualFlow } from '../queries'

export interface ChosenFlow {
  id: number
  name: string
}

interface Props {
  chatId: string
  flow: ChosenFlow
  /** Se llama al cancelar y cuando el pedido terminó, salga bien o mal. */
  onClose: () => void
}

/**
 * Confirmación de "Iniciar flujo", en la franja de arriba del cuadro de
 * escritura (entre "Mensaje de WhatsApp" y "Cambiar a nota interna").
 *
 * Elegir un flujo de la lista lo lanzaba en el acto, y un flujo le escribe al
 * cliente: un toque equivocado ya no tenía vuelta atrás. Va en línea y no en un
 * modal porque es una decisión corta sobre algo que el vendedor acaba de
 * elegir, a la vista del chat.
 *
 * La mutación vive acá y la franja sigue montada hasta que el pedido termina:
 * React Query no corre los callbacks de un mutate cuyo componente ya no está.
 */
export function FlowStartConfirmation({ chatId, flow, onClose }: Props) {
  const startFlow = useStartManualFlow()
  const confirmRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    confirmRef.current?.focus()
  }, [flow.id])

  function confirm() {
    startFlow.mutate(
      { ruleId: flow.id, chatId },
      {
        onSuccess: () => toast.success(`Flujo "${flow.name}" iniciado`),
        onError: (error) => toast.error(extractErrorMessage(error)),
        onSettled: onClose,
      }
    )
  }

  return (
    <div
      role="group"
      aria-label={`Confirmar el flujo ${flow.name}`}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !startFlow.isPending) {
          event.preventDefault()
          onClose()
        }
      }}
      className="flex min-w-0 flex-1 items-center justify-center gap-1.5"
    >
      <span className="min-w-0 truncate text-[11px] text-fg">
        ¿Iniciar <span className="font-semibold">«{flow.name}»</span>?
      </span>
      <button
        type="button"
        onClick={onClose}
        disabled={startFlow.isPending}
        className="shrink-0 rounded-md px-2 py-1 text-[11px] font-semibold text-fg-muted outline-none transition-colors hover:bg-subtle focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
      >
        Cancelar
      </button>
      <button
        ref={confirmRef}
        type="button"
        onClick={confirm}
        disabled={startFlow.isPending}
        className="flex shrink-0 items-center gap-1 rounded-md bg-accent-fill px-2 py-1 text-[11px] font-semibold text-on-accent outline-none transition-colors hover:bg-[color-mix(in_srgb,var(--accent-fill),#000_8%)] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-surface disabled:cursor-wait disabled:opacity-70"
      >
        {startFlow.isPending && <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />}
        Iniciar
      </button>
    </div>
  )
}
