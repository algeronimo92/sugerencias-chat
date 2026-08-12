import { useState } from 'react'
import { Tags, Sparkles } from 'lucide-react'
import { ServicesManagementPanel } from './ServicesManagementPanel'
import { TagsManagementPanel } from './TagsManagementPanel'

type CatalogTab = 'services' | 'tags'

const tabClass = (active: boolean) =>
  `inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
    active
      ? 'bg-wa-primary text-white shadow-sm'
      : 'text-wa-muted hover:bg-wa-hover hover:text-wa-text dark:text-wa-muted-dark dark:hover:bg-wa-hover-dark dark:hover:text-wa-text-dark'
  }`

export function CatalogsPage() {
  const [tab, setTab] = useState<CatalogTab>('services')

  return (
    <main className="flex min-h-0 flex-1 flex-col overflow-hidden bg-wa-app dark:bg-wa-app-dark">
      <header className="shrink-0 border-b border-wa-border bg-white px-4 py-4 dark:border-wa-border-dark dark:bg-wa-panel-dark sm:px-6">
        <h1 className="text-lg font-semibold text-wa-text dark:text-wa-text-dark">Catálogos</h1>
        <p className="mt-1 text-xs text-wa-muted dark:text-wa-muted-dark">Administra los valores reutilizables del CRM desde un solo lugar.</p>
        <nav className="mt-4 flex items-center gap-1" aria-label="Catálogos disponibles">
          <button type="button" onClick={() => setTab('services')} className={tabClass(tab === 'services')}>
            <Sparkles className="h-4 w-4" /> Servicios
          </button>
          <button type="button" onClick={() => setTab('tags')} className={tabClass(tab === 'tags')}>
            <Tags className="h-4 w-4" /> Etiquetas
          </button>
        </nav>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="mx-auto max-w-4xl">
          {tab === 'services' ? <ServicesManagementPanel /> : <TagsManagementPanel />}
        </div>
      </div>
    </main>
  )
}
