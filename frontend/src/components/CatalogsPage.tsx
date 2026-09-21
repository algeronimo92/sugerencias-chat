import { useState } from 'react'
import { FolderTree, Tags, Sparkles } from 'lucide-react'
import { ServicesManagementPanel } from './ServicesManagementPanel'
import { TagsManagementPanel } from './TagsManagementPanel'
import { TemplateCategoriesManagementPanel } from './TemplateCategoriesManagementPanel'

type CatalogTab = 'services' | 'tags' | 'template-categories'

const TABS: readonly { key: CatalogTab; label: string; icon: typeof Sparkles }[] = [
  { key: 'services', label: 'Servicios', icon: Sparkles },
  { key: 'tags', label: 'Etiquetas', icon: Tags },
  { key: 'template-categories', label: 'Categorías de plantillas', icon: FolderTree },
]

const tabClass = (active: boolean) =>
  `inline-flex min-h-11 shrink-0 items-center gap-2 rounded-md px-3 text-sm font-semibold outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-wa-primary/60 sm:min-h-9 ${
    active
      ? 'bg-wa-primary/12 text-wa-primary-strong dark:bg-wa-primary/20 dark:text-wa-primary'
      : 'text-wa-muted hover:bg-wa-hover hover:text-wa-text dark:text-wa-muted-dark dark:hover:bg-wa-head-dark dark:hover:text-wa-text-dark'
  }`

export function CatalogsPage() {
  const [tab, setTab] = useState<CatalogTab>('services')

  return (
    <div className="h-full overflow-x-hidden overflow-y-auto bg-wa-app dark:bg-wa-app-dark">
      <main className="mx-auto w-full max-w-[1120px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight text-wa-text dark:text-white">Catálogos</h1>
          <p className="mt-1.5 max-w-prose text-sm leading-6 text-wa-muted dark:text-wa-muted-dark">
            Organiza los servicios, etiquetas y categorías que usa tu equipo.
          </p>

          <div
            role="group"
            aria-label="Catálogos disponibles"
            className="mt-5 flex max-w-full items-center gap-1 overflow-x-auto rounded-lg border border-wa-border bg-white p-1 dark:border-wa-border-dark dark:bg-wa-panel-dark sm:w-fit"
          >
            {TABS.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                aria-pressed={tab === key}
                className={tabClass(tab === key)}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                {label}
              </button>
            ))}
          </div>
        </header>

        <section aria-label={TABS.find(item => item.key === tab)?.label} className="mt-5">
          {tab === 'services'
            ? <ServicesManagementPanel />
            : tab === 'tags'
              ? <TagsManagementPanel />
              : <TemplateCategoriesManagementPanel />}
        </section>
      </main>
    </div>
  )
}
