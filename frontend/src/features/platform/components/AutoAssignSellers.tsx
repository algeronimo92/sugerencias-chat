import { Checkbox } from '../../../shared/ui/Checkbox'
import { useSellers } from '../hooks/useUsers'

interface Props {
  /** Ids excluidos separados por coma, tal como los guarda el backend. */
  value: string
  onChange: (value: string) => void
}

function parseIds(value: string): Set<number> {
  return new Set(
    value
      .split(',')
      .map((part) => part.trim())
      .filter((part) => /^\d+$/.test(part))
      .map(Number)
  )
}

// El ajuste guarda a quién se excluye (así un vendedor nuevo entra al reparto
// sin que nadie tenga que acordarse de sumarlo), pero la lista se muestra en
// positivo: marcar "recibe leads" se entiende mejor que marcar una exclusión.
export function AutoAssignSellers({ value, onChange }: Props) {
  const { data, isLoading, error } = useSellers()
  const sellers = (data ?? []).filter((seller) => seller.role === 'vendedor')
  const excluded = parseIds(value)

  function toggle(id: number, receives: boolean) {
    const next = new Set(excluded)
    if (receives) next.delete(id)
    else next.add(id)
    onChange([...next].sort((a, b) => a - b).join(','))
  }

  if (isLoading) {
    return <p className="text-xs text-wa-muted dark:text-wa-muted-dark">Cargando vendedores...</p>
  }
  if (error) {
    return <p className="text-xs text-red-500 dark:text-red-400">No se pudo cargar la lista de vendedores.</p>
  }
  if (sellers.length === 0) {
    return (
      <p className="text-xs text-wa-muted dark:text-wa-muted-dark">
        No hay vendedores activos: los leads nuevos quedan sin asignar hasta que agregues uno en Usuarios.
      </p>
    )
  }

  const receiving = sellers.filter((seller) => !excluded.has(seller.id)).length

  return (
    <fieldset className="rounded-lg bg-wa-hover px-3 py-2.5 dark:bg-wa-head-dark/60">
      <legend className="sr-only">Vendedores que reciben leads del reparto</legend>
      <p className="mb-2 text-xs text-wa-muted dark:text-wa-muted-dark">
        Reciben leads ({receiving} de {sellers.length})
      </p>
      <div className="space-y-1.5">
        {sellers.map((seller) => (
          <label key={seller.id} className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
            <Checkbox
              checked={!excluded.has(seller.id)}
              onCheckedChange={(checked) => toggle(seller.id, checked)}
            />
            {seller.name}
          </label>
        ))}
      </div>
      {receiving === 0 && (
        <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
          Nadie recibe leads: los nuevos quedarán sin asignar.
        </p>
      )}
    </fieldset>
  )
}
