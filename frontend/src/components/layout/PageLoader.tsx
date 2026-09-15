import { Spinner } from '../ui/Spinner'

export function PageLoader() {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center bg-wa-app dark:bg-wa-app-dark">
      <Spinner label="Cargando vista…" />
    </div>
  )
}
