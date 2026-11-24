import { Bot, PencilRuler, Send } from 'lucide-react'
import { Modal } from '../../../shared/ui/Modal'
import { recipesFor, type FlowRecipe, type FlowStarter, type RecipeSection } from '../domain/flowRecipes'

const SECTION_TITLE: Record<RecipeSection, string> = {
  automatic: 'Que el sistema lo haga solo',
  sequences: 'Que tu equipo lo lance desde el chat',
}

const CARD = 'flex w-full items-start gap-3 rounded-xl border border-line bg-surface p-3 text-left outline-none transition-colors hover:border-line-control hover:bg-subtle focus-visible:ring-2 focus-visible:ring-ring'

interface Props {
  /** La sección desde la que se abrió: sus recetas van primero. */
  section: RecipeSection
  /** `null` es «empezar de cero»: el editor abre con su flujo mínimo. */
  onChoose: (starter: FlowStarter | null) => void
  onClose: () => void
}

/**
 * Lo primero que se ve al crear una automatización: qué se quiere lograr, no
 * un lienzo en blanco. Elegir una receta abre el editor con ese flujo armado
 * y sin guardar; el lienzo vacío queda como última opción.
 */
export function RecipePicker({ section, onChoose, onClose }: Props) {
  const sections: RecipeSection[] = section === 'sequences' ? ['sequences', 'automatic'] : ['automatic', 'sequences']

  function card(recipe: FlowRecipe) {
    const Icon = recipe.section === 'sequences' ? Send : Bot
    return (
      <li key={recipe.id}>
        <button type="button" onClick={() => onChoose(recipe.build())} className={CARD}>
          <Icon className="mt-0.5 h-4 w-4 shrink-0 text-accent-strong" aria-hidden="true" />
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-fg">{recipe.title}</span>
            <span className="mt-0.5 block text-sm text-fg-muted">{recipe.when} {recipe.does}</span>
          </span>
        </button>
      </li>
    )
  }

  return (
    <Modal
      title="¿Qué quieres automatizar?"
      description="Elige un punto de partida. Se abre en el editor para que ajustes los textos; nada se envía hasta que lo publiques."
      size="lg"
      onClose={onClose}
    >
      <div className="space-y-5">
        {sections.map(key => (
          <section key={key} aria-labelledby={`recetas-${key}`}>
            <h3 id={`recetas-${key}`} className="mb-2 text-sm font-semibold text-fg">{SECTION_TITLE[key]}</h3>
            <ul className="grid gap-2 sm:grid-cols-2">{recipesFor(key).map(card)}</ul>
          </section>
        ))}
        <button type="button" onClick={() => onChoose(null)} className={CARD}>
          <PencilRuler className="mt-0.5 h-4 w-4 shrink-0 text-fg-muted" aria-hidden="true" />
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-fg">Empezar de cero</span>
            <span className="mt-0.5 block text-sm text-fg-muted">Abre el editor con un flujo mínimo para armarlo bloque por bloque.</span>
          </span>
        </button>
      </div>
    </Modal>
  )
}
