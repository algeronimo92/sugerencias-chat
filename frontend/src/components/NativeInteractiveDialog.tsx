import { useState } from 'react'
import { Loader2, Send, X } from 'lucide-react'
import { toast } from 'sonner'

import type { TemplateCapabilities } from '../types'
import { useSendInteractive, type ReplyTarget } from '../hooks/useMessages'
import {
  availableNativeInteractives, buildNativeInteractive, EMPTY_NATIVE_INTERACTIVE_FORM, NATIVE_INTERACTIVE_LABELS,
  type NativeInteractiveForm,
} from '../domain/nativeInteractive'
import { META_CONTRACT } from '../domain/metaContract'
import { extractErrorMessage } from '../utils/errors'
import { DialogPrimitive as Dialog, dialogContentPositionClass, dialogOverlayClass } from './ui/Dialog'
import { Input, labelClass, Select, Textarea } from './ui/Input'

interface Props {
  chatId: string
  capabilities: TemplateCapabilities
  replyTo: ReplyTarget | null
  onSent: () => void
  onClose: () => void
}

const LIMITS = META_CONTRACT.limits

/** Envío de los interactivos de Meta que dependen de la cuenta: producto,
 * lista de productos, catálogo, Flow y pedido de permiso de llamada. Solo
 * ofrece los que la cuenta tiene habilitados. */
export function NativeInteractiveDialog({ chatId, capabilities, replyTo, onSent, onClose }: Props) {
  const kinds = availableNativeInteractives(capabilities)
  const [form, setForm] = useState<NativeInteractiveForm>({
    ...EMPTY_NATIVE_INTERACTIVE_FORM,
    kind: kinds[0] ?? 'product',
    flow: capabilities.published_flows?.[0] ?? '',
  })
  const [showErrors, setShowErrors] = useState(false)
  const { mutate: sendInteractive, isPending } = useSendInteractive(chatId)
  const { interactive, errors } = buildNativeInteractive(form, capabilities)

  function update(patch: Partial<NativeInteractiveForm>) {
    setForm(current => ({ ...current, ...patch }))
  }

  function submit() {
    if (isPending) return
    if (!interactive) {
      setShowErrors(true)
      return
    }
    sendInteractive(
      { interactive, replyTo },
      {
        onSuccess: () => {
          toast.success(`${NATIVE_INTERACTIVE_LABELS[form.kind]} enviado`)
          onSent()
          onClose()
        },
        onError: error => toast.error(extractErrorMessage(error)),
      },
    )
  }

  const bodyRequired = form.kind !== 'product'
  const showHeader = form.kind === 'product_list' || form.kind === 'flow'

  return (
    <Dialog.Root open onOpenChange={open => { if (!open && !isPending) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className={dialogOverlayClass} />
        <Dialog.Content
          className={`${dialogContentPositionClass} flex max-h-[90vh] w-[calc(100%-2rem)] max-w-lg flex-col overflow-hidden rounded-2xl border border-wa-border bg-white shadow-2xl dark:border-wa-border-dark dark:bg-wa-panel-dark`}
          aria-describedby={undefined}
        >
          <div className="flex items-center gap-3 border-b border-wa-border px-4 py-3 dark:border-wa-border-dark">
            <button
              type="button"
              onClick={onClose}
              disabled={isPending}
              aria-label="Cerrar"
              className="rounded-full p-1.5 text-wa-muted hover:bg-wa-field disabled:opacity-50 dark:text-wa-muted-dark dark:hover:bg-wa-head-dark"
            >
              <X className="h-5 w-5" />
            </button>
            <Dialog.Title className="text-base font-semibold text-wa-text dark:text-wa-text-dark">
              Mensaje interactivo de WhatsApp
            </Dialog.Title>
          </div>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
            <div role="radiogroup" aria-label="Tipo de mensaje" className="flex flex-wrap gap-1.5">
              {kinds.map(kind => (
                <button
                  key={kind}
                  type="button"
                  role="radio"
                  aria-checked={form.kind === kind}
                  onClick={() => { update({ kind }); setShowErrors(false) }}
                  className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                    form.kind === kind
                      ? 'border-wa-primary bg-wa-primary/10 text-wa-primary-strong dark:text-wa-primary'
                      : 'border-wa-border text-wa-muted hover:bg-wa-hover dark:border-wa-border-dark dark:text-wa-muted-dark dark:hover:bg-wa-hover-dark'
                  }`}
                >
                  {NATIVE_INTERACTIVE_LABELS[kind]}
                </button>
              ))}
            </div>

            {form.kind === 'flow' && (
              <>
                <label className="block">
                  <span className={labelClass}>Flow publicado</span>
                  <Select value={form.flow} onChange={event => update({ flow: event.target.value })} aria-label="Flow publicado">
                    {(capabilities.published_flows ?? []).map(flow => <option key={flow} value={flow}>{flow}</option>)}
                  </Select>
                </label>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className={labelClass}>Texto del botón</span>
                    <Input value={form.flowCta} maxLength={LIMITS.button_title} onChange={event => update({ flowCta: event.target.value })} placeholder="Ej. Reservar" />
                  </label>
                  <label className="block">
                    <span className={labelClass}>Al abrirlo</span>
                    <Select value={form.flowAction} onChange={event => update({ flowAction: event.target.value === 'data_exchange' ? 'data_exchange' : 'navigate' })} aria-label="Al abrirlo">
                      <option value="navigate">Ir a una pantalla</option>
                      <option value="data_exchange">Pedir la pantalla al endpoint</option>
                    </Select>
                  </label>
                </div>
                {form.flowAction === 'navigate' && (
                  <label className="block">
                    <span className={labelClass}>Pantalla inicial</span>
                    <Input value={form.flowScreen} onChange={event => update({ flowScreen: event.target.value })} placeholder="Ej. RESERVA" className="font-mono" />
                  </label>
                )}
              </>
            )}

            {showHeader && (
              <label className="block">
                <span className={labelClass}>Encabezado{form.kind === 'flow' ? ' (opcional)' : ''}</span>
                <Input value={form.header} maxLength={LIMITS.header_text} onChange={event => update({ header: event.target.value })} />
              </label>
            )}

            <label className="block">
              <span className={labelClass}>Cuerpo{bodyRequired ? '' : ' (opcional)'}</span>
              <Textarea rows={3} value={form.body} maxLength={LIMITS.body} onChange={event => update({ body: event.target.value })} />
            </label>

            {form.kind === 'product' && (
              <label className="block">
                <span className={labelClass}>SKU del producto</span>
                <Input value={form.sku} onChange={event => update({ sku: event.target.value })} placeholder="product_retailer_id" className="font-mono" />
              </label>
            )}

            {form.kind === 'catalog_message' && (
              <label className="block">
                <span className={labelClass}>SKU de la miniatura (opcional)</span>
                <Input value={form.sku} onChange={event => update({ sku: event.target.value })} placeholder="Si no, Meta usa el primer producto" className="font-mono" />
              </label>
            )}

            {form.kind === 'product_list' && (
              <>
                <label className="block">
                  <span className={labelClass}>Título de la sección</span>
                  <Input value={form.sectionTitle} maxLength={LIMITS.section_title} onChange={event => update({ sectionTitle: event.target.value })} />
                </label>
                <label className="block">
                  <span className={labelClass}>SKUs (uno por línea, hasta {LIMITS.max_products})</span>
                  <Textarea rows={4} value={form.skus} onChange={event => update({ skus: event.target.value })} className="font-mono" />
                </label>
              </>
            )}

            <label className="block">
              <span className={labelClass}>Pie (opcional)</span>
              <Input value={form.footer} maxLength={LIMITS.footer} onChange={event => update({ footer: event.target.value })} />
            </label>

            {(form.kind === 'product' || form.kind === 'product_list' || form.kind === 'catalog_message') && (
              <p className="text-[11px] text-wa-muted dark:text-wa-muted-dark">
                Catálogo de la cuenta: <span className="font-mono">{capabilities.catalog_id}</span>
              </p>
            )}

            {showErrors && errors.length > 0 && (
              <ul role="alert" className="space-y-0.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
                {errors.map(error => <li key={error}>{error}</li>)}
              </ul>
            )}
          </div>

          <div className="flex justify-end border-t border-wa-border px-5 py-3 dark:border-wa-border-dark">
            <button
              type="button"
              onClick={submit}
              disabled={isPending}
              className="inline-flex items-center gap-2 rounded-full bg-wa-primary px-4 py-2 text-sm font-medium text-white shadow hover:bg-wa-primary-strong disabled:cursor-wait disabled:opacity-60"
            >
              {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Enviar
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
