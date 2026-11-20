import { X } from "lucide-react";
import { Checkbox } from "../../../../shared/ui/Checkbox";
import { Select } from "../../../../shared/ui/Input";
import { TagChip } from "../../../../shared/ui/TagChip";
import { useTags } from "../../../catalogs/public/useTags";
import { useLeadStageCatalog } from "../../../leads/public/useLeadStages";
import { EMPTY_CHAT_FILTERS, type ChatFilters, type LeadStage } from "../../../leads/types";
import { useSellers } from "../../../platform/public/useUsers";

interface Props {
  advancedFilters: ChatFilters;
  onAdvancedFiltersChange: (value: ChatFilters) => void;
  activeAdvancedFilterCount: number;
}

/** Panel de filtros avanzados de la lista. Se monta solo al abrirlo, así que
 * las etiquetas y las vendedoras no se piden al cargar la lista. */
export function AdvancedFiltersPanel({
  advancedFilters,
  onAdvancedFiltersChange,
  activeAdvancedFilterCount,
}: Props) {
  const { data: tags = [] } = useTags(false);
  const selectedTagIds = new Set(advancedFilters.tagIds);
  const selectedStages = new Set(advancedFilters.stages);
  const stageCatalog = useLeadStageCatalog();
  const catalogStageKeys = new Set(stageCatalog.stages.map((stage) => stage.key));
  // Todas las etapas, también las desactivadas (sus leads siguen ahí), y las
  // de un filtro ya aplicado aunque el negocio las haya borrado.
  const filterStages = [
    ...stageCatalog.stages,
    ...advancedFilters.stages
      .filter((key) => !catalogStageKeys.has(key))
      .map((key) => stageCatalog.get(key)),
  ];
  const { data: sellers = [] } = useSellers();

  function toggleStage(stage: LeadStage) {
    const stages = advancedFilters.stages.includes(stage)
      ? advancedFilters.stages.filter((item) => item !== stage)
      : [...advancedFilters.stages, stage];
    onAdvancedFiltersChange({ ...advancedFilters, stages });
  }

  function toggleTag(tagId: number) {
    const tagIds = advancedFilters.tagIds.includes(tagId)
      ? advancedFilters.tagIds.filter((item) => item !== tagId)
      : [...advancedFilters.tagIds, tagId];
    onAdvancedFiltersChange({ ...advancedFilters, tagIds });
  }

  function clearAdvancedFilters() {
    onAdvancedFiltersChange(EMPTY_CHAT_FILTERS);
  }

  return (
    <div className="mt-2 max-h-80 space-y-3 overflow-y-auto rounded-xl border border-wa-border bg-wa-field/50 p-3 dark:border-wa-border-dark dark:bg-wa-field-dark/35">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-wa-muted dark:text-wa-muted-dark">
          Etapas
        </span>
        {activeAdvancedFilterCount > 0 && (
          <button
            type="button"
            onClick={clearAdvancedFilters}
            className="flex items-center gap-1 text-[11px] text-red-500 hover:text-red-600"
          >
            <X className="h-3 w-3" /> Limpiar
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {filterStages.map((stage) => (
          <button
            key={stage.key}
            type="button"
            onClick={() => toggleStage(stage.key)}
            aria-pressed={selectedStages.has(stage.key)}
            title={stage.is_active ? undefined : "Etapa desactivada"}
            className={`rounded-full border px-2 py-1 text-[11px] transition-colors ${stage.is_active ? "" : "border-dashed"} ${
              selectedStages.has(stage.key)
                ? "border-wa-primary bg-wa-primary/15 text-wa-primary-strong dark:bg-wa-primary/20 dark:text-wa-primary"
                : "border-wa-border bg-white text-wa-muted dark:border-wa-border-dark dark:bg-wa-head-dark dark:text-wa-muted-dark"
            }`}
          >
            {stage.name}
          </button>
        ))}
      </div>

      {tags.length > 0 && (
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-wa-muted dark:text-wa-muted-dark">
              Etiquetas
            </span>
            <Select
              value={advancedFilters.tagMode}
              onChange={(event) =>
                onAdvancedFiltersChange({
                  ...advancedFilters,
                  tagMode: event.target.value as "any" | "all",
                })
              }
              className="rounded border border-wa-border bg-white px-1.5 py-0.5 text-[10px] text-wa-muted dark:border-wa-border-dark dark:bg-wa-head-dark dark:text-wa-muted-dark"
            >
              <option value="any">Cualquiera</option>
              <option value="all">Todas</option>
            </Select>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {tags.map((tag) => {
              const selected = selectedTagIds.has(tag.id)
              return (
                <button
                  key={tag.id}
                  type="button"
                  onClick={() => toggleTag(tag.id)}
                  aria-pressed={selected}
                  className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <TagChip
                    name={tag.name}
                    color={tag.color}
                    size="md"
                    selected={selected}
                    className={selected ? "ring-1 ring-line-control" : "hover:bg-selected"}
                  />
                </button>
              )
            })}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        {(
          [
            ["service", "Servicio"],
            ["origin", "Origen"],
          ] as const
        ).map(([key, label]) => (
          <input
            key={key}
            value={advancedFilters[key]}
            onChange={(event) =>
              onAdvancedFiltersChange({
                ...advancedFilters,
                [key]: event.target.value,
              })
            }
            placeholder={label}
            aria-label={label}
            className="min-w-0 rounded-md border border-wa-border bg-white px-2 py-1.5 text-xs text-wa-text outline-none focus:border-wa-primary dark:border-wa-border-dark dark:bg-wa-head-dark dark:text-wa-text-dark"
          />
        ))}
        <Select
          value={advancedFilters.sellerId ?? ""}
          onChange={(event) =>
            onAdvancedFiltersChange({
              ...advancedFilters,
              sellerId: event.target.value
                ? Number(event.target.value)
                : null,
            })
          }
          className="rounded-md border border-wa-border bg-white px-2 py-1.5 text-xs text-wa-muted dark:border-wa-border-dark dark:bg-wa-head-dark dark:text-wa-muted-dark"
        >
          <option value="">Cualquier vendedor</option>
          {sellers.map((seller) => (
            <option key={seller.id} value={seller.id}>
              {seller.name}
            </option>
          ))}
        </Select>
        <Select
          value={advancedFilters.lastSender}
          onChange={(event) =>
            onAdvancedFiltersChange({
              ...advancedFilters,
              lastSender: event.target.value as ChatFilters["lastSender"],
            })
          }
          className="rounded-md border border-wa-border bg-white px-2 py-1.5 text-xs text-wa-muted dark:border-wa-border-dark dark:bg-wa-head-dark dark:text-wa-muted-dark"
        >
          <option value="">Último emisor</option>
          <option value="cliente">Cliente</option>
          <option value="vendedor">Vendedor</option>
        </Select>
        <input
          type="number"
          min={1}
          value={advancedFilters.inactiveDays ?? ""}
          onChange={(event) =>
            onAdvancedFiltersChange({
              ...advancedFilters,
              inactiveDays: event.target.value
                ? Number(event.target.value)
                : null,
            })
          }
          placeholder="Inactivo (días)"
          aria-label="Días sin actividad"
          className="min-w-0 rounded-md border border-wa-border bg-white px-2 py-1.5 text-xs text-wa-text outline-none focus:border-wa-primary dark:border-wa-border-dark dark:bg-wa-head-dark dark:text-wa-text-dark"
        />
        <Select
          value={advancedFilters.waitingTime}
          onChange={(event) =>
            onAdvancedFiltersChange({
              ...advancedFilters,
              waitingTime: event.target
                .value as ChatFilters["waitingTime"],
            })
          }
          title="Tiempo desde el último mensaje del cliente sin respuesta del vendedor"
          className="col-span-2 rounded-md border border-wa-border bg-white px-2 py-1.5 text-xs text-wa-muted dark:border-wa-border-dark dark:bg-wa-head-dark dark:text-wa-muted-dark"
        >
          <option value="">Tiempo sin responder</option>
          <option value="any">Todos esperando respuesta</option>
          <option value="fresh">Menos de 10 minutos</option>
          <option value="warning">Entre 10 minutos y 1 hora</option>
          <option value="urgent">Más de 1 hora</option>
        </Select>
      </div>

      <label className="flex items-center gap-2 text-xs text-wa-muted dark:text-wa-muted-dark">
        <Checkbox
          checked={advancedFilters.automationPaused}
          onCheckedChange={(checked) =>
            onAdvancedFiltersChange({
              ...advancedFilters,
              automationPaused: checked,
            })
          }
        />
        Solo sin automatizaciones nuevas
      </label>
    </div>
  );
}
