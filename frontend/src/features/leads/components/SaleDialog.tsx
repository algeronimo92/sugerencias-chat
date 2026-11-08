import { X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button } from '../../../shared/ui/Button'
import { DialogPrimitive as Dialog, dialogContentPositionClass, dialogOverlayClass } from '../../../shared/ui/Dialog'
import { Input, Select, Textarea, labelClass } from '../../../shared/ui/Input'
import { useLeadServices } from '../../catalogs/public/useLeadServices'
import type { LeadSaleInput } from '../types'

interface Props {
  /** Nombre visible del lead, para el título. */
  leadName: string
  /** El servicio que le interesaba: preselecciona el servicio del paquete. */
  defaultServiceName?: string | null
  /** Etapa ganada a la que se mueve; sin ella el diálogo solo registra. */
  stageName?: string | null
  /** `null` cuando el asesor prefiere mover sin registrar (solo con `allowSkip`). */
  onConfirm: (sale: LeadSaleInput | null) => void
  onCancel: () => void
  allowSkip?: boolean
  isPending?: boolean
}

type SellableService = ReturnType<typeof useSellableServices>['sellable'][number]

/** Solo lo vendible: servicios activos con al menos un paquete activo. */
function useSellableServices() {
  const { data: services = [], isLoading } = useLeadServices()
  const sellable = useMemo(
    () => services
      .map(service => ({ ...service, packages: (service.packages ?? []).filter(pkg => pkg.is_active) }))
      .filter(service => service.packages.length > 0),
    [services],
  )
  return { sellable, isLoading }
}

function findDefaultService(sellable: SellableService[], defaultServiceName: string | null | undefined): SellableService | null {
  const wanted = defaultServiceName?.trim().toLowerCase()
  const byName = wanted ? sellable.find(item => item.name.toLowerCase() === wanted) : undefined
  if (byName) return byName
  return sellable.length === 1 ? sellable[0] : null
}

/**
 * Servicio, paquete y monto. Lo elegido por el usuario manda; lo que todavía
 * no tocó (null) se deduce en el render: el servicio de interés del lead, el
 * único paquete del servicio y el precio de lista. No se corrige con efectos:
 * los servicios llegan después del primer render y un efecto que "acomoda" el
 * estado cuesta un render extra y puede pisar lo elegido.
 */
function useSaleSelection(sellable: SellableService[], defaultServiceName: string | null | undefined) {
  const [chosenServiceId, setChosenServiceId] = useState<string | null>(null)
  const [chosenPackageId, setChosenPackageId] = useState<string | null>(null)
  const [editedAmount, setEditedAmount] = useState<string | null>(null)

  const defaultService = useMemo(() => findDefaultService(sellable, defaultServiceName), [sellable, defaultServiceName])
  const serviceId = chosenServiceId ?? (defaultService ? String(defaultService.id) : '')
  const service = sellable.find(item => String(item.id) === serviceId) ?? null
  const onlyPackage = service?.packages.length === 1 ? service.packages[0] : null
  const packageId = chosenPackageId ?? (onlyPackage ? String(onlyPackage.id) : '')
  const pkg = service?.packages.find(item => String(item.id) === packageId) ?? null

  return {
    serviceId, service, packageId, pkg,
    amount: editedAmount ?? pkg?.price ?? '',
    setAmount: setEditedAmount,
    chooseService(nextId: string) {
      setChosenServiceId(nextId)
      setChosenPackageId(null)
      setEditedAmount(null)
    },
    choosePackage(nextId: string) {
      setChosenPackageId(nextId)
      setEditedAmount(null)
    },
  }
}

function saleError(hasSelection: boolean, amount: string): string | null {
  if (!hasSelection) return 'Elige el servicio y el paquete que compró'
  if (amount !== '' && !(Number(amount) >= 0)) return 'El monto debe ser un número mayor o igual a cero'
  return null
}

/**
 * El interés del lead es el servicio (el problema); el cierre es un paquete
 * concreto con su precio. El monto se prellena con el precio de lista y se
 * puede bajar si hubo descuento; el precio de lista queda guardado igual.
 */
export function SaleDialog({ leadName, defaultServiceName, stageName, onConfirm, onCancel, allowSkip = false, isPending = false }: Props) {
  const { sellable, isLoading } = useSellableServices()
  const selection = useSaleSelection(sellable, defaultServiceName)
  const { serviceId, service, packageId, pkg, amount } = selection
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)

  function chooseService(nextId: string) {
    selection.chooseService(nextId)
    setError(null)
  }

  function choosePackage(nextId: string) {
    selection.choosePackage(nextId)
    setError(null)
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    const trimmed = amount.trim()
    const problem = saleError(Boolean(service && pkg), trimmed)
    setError(problem)
    if (problem || !service || !pkg) return
    onConfirm({
      service_id: service.id,
      package_id: pkg.id,
      amount: trimmed === '' ? null : trimmed,
      notes: notes.trim() || null,
    })
  }

  const title = stageName ? `Mover a ${stageName}` : 'Registrar compra'
  const confirmLabel = stageName ? `Mover y registrar` : 'Registrar compra'

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) onCancel() }}>
      <Dialog.Portal>
        <Dialog.Overlay className={dialogOverlayClass} />
        <Dialog.Content asChild>
          <form
            onSubmit={handleSubmit}
            className={`${dialogContentPositionClass} w-[calc(100%-2rem)] max-w-md overflow-hidden rounded-xl border border-wa-border bg-white shadow-xl dark:border-wa-border-dark dark:bg-wa-panel-dark`}
          >
            <div className="flex items-center justify-between border-b border-wa-border px-4 py-3 dark:border-wa-border-dark">
              <Dialog.Title className="text-sm font-semibold text-wa-text dark:text-wa-text-dark">{title}</Dialog.Title>
              <button type="button" onClick={onCancel} aria-label="Cerrar" className="text-wa-muted transition-colors hover:text-gray-600 dark:hover:text-gray-300">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-3 px-4 py-4">
              <Dialog.Description className="text-xs text-wa-muted dark:text-wa-muted-dark">
                ¿Con qué paquete cerró {leadName}? Queda en la ficha, en el historial del chat y en las ventas del dashboard.
              </Dialog.Description>

              {!isLoading && sellable.length === 0 ? (
                <p role="alert" className="rounded-lg border border-dashed border-wa-border px-3 py-2 text-xs text-wa-muted dark:border-wa-border-dark dark:text-wa-muted-dark">
                  No hay paquetes para vender: carga los paquetes de tus servicios en Catálogos (o sincroniza el ERP).
                </p>
              ) : (
                <>
                  <div>
                    <label htmlFor="sale-service" className={labelClass}>Servicio</label>
                    <Select id="sale-service" value={serviceId} onValueChange={chooseService} aria-label="Servicio">
                      <option value="">Elegir servicio…</option>
                      {sellable.map(item => <option key={item.id} value={String(item.id)}>{item.name}</option>)}
                    </Select>
                  </div>
                  <div>
                    <label htmlFor="sale-package" className={labelClass}>Paquete</label>
                    <Select id="sale-package" value={packageId} onValueChange={choosePackage} disabled={!service} aria-label="Paquete">
                      <option value="">Elegir paquete…</option>
                      {service?.packages.map(item => (
                        <option key={item.id} value={String(item.id)}>
                          {`${item.name} · ${item.sessions} ${item.sessions === 1 ? 'sesión' : 'sesiones'} · ${item.price}`}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div className="grid grid-cols-[8rem_minmax(0,1fr)] gap-3">
                    <div>
                      <label htmlFor="sale-amount" className={labelClass}>Monto cobrado</label>
                      <Input
                        id="sale-amount"
                        type="number"
                        inputMode="decimal"
                        min={0}
                        step="0.01"
                        value={amount}
                        onChange={event => selection.setAmount(event.target.value)}
                        placeholder={pkg ? pkg.price : '0.00'}
                        disabled={!pkg}
                      />
                      {pkg && amount.trim() !== '' && Number(amount) !== Number(pkg.price) && (
                        <p className="mt-1 text-[11px] text-wa-muted dark:text-wa-muted-dark">Lista: {pkg.price}</p>
                      )}
                    </div>
                    <div>
                      <label htmlFor="sale-notes" className={labelClass}>Notas</label>
                      <Textarea id="sale-notes" rows={2} value={notes} onChange={event => setNotes(event.target.value)} maxLength={500} placeholder="Descuento, forma de pago… (opcional)" className="resize-none" />
                    </div>
                  </div>
                </>
              )}
              {error && <p role="alert" className="text-xs text-red-700 dark:text-red-300">{error}</p>}
            </div>

            <div className="flex border-t border-wa-border dark:border-wa-border-dark">
              <Button variant="ghost" onClick={onCancel} className="h-11 flex-1 rounded-none">Cancelar</Button>
              {allowSkip && (
                <Button variant="ghost" onClick={() => onConfirm(null)} className="h-11 flex-1 rounded-none border-l border-wa-border dark:border-wa-border-dark" disabled={isPending}>
                  Mover sin registrar
                </Button>
              )}
              <Button type="submit" variant="primary" className="h-11 flex-1 rounded-none border-l border-wa-border dark:border-wa-border-dark" disabled={isPending || sellable.length === 0}>
                {confirmLabel}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
