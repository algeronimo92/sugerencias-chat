import type { Meta, StoryObj } from '@storybook/react-vite'
import { Inbox, Plus } from 'lucide-react'
import { Badge } from './Badge'
import { Button } from './Button'
import { Card } from './Card'
import { Checkbox } from './Checkbox'
import { EmptyState } from './EmptyState'
import { Input, Select, Textarea } from './Input'
import { Skeleton } from './Skeleton'
import { Tooltip } from './Tooltip'

const meta = {
  title: 'Sistema/UI base',
  component: Button,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof Button>

export default meta
type Story = StoryObj<typeof meta>

export const Controles: Story = {
  render: () => (
    <Card className="w-[min(42rem,90vw)] space-y-6 p-5">
      <section>
        <h2 className="mb-3 text-sm font-semibold">Acciones</h2>
        <div className="flex flex-wrap gap-2">
          <Button><Plus className="h-4 w-4" />Crear</Button>
          <Button variant="secondary">Secundaria</Button>
          <Button variant="ghost">Discreta</Button>
          <Button variant="danger">Eliminar</Button>
          <Tooltip content="Acción con contexto"><Button size="icon" aria-label="Agregar"><Plus className="h-4 w-4" /></Button></Tooltip>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-xs text-wa-muted">Nombre<Input placeholder="Nombre del lead" /></label>
        <label className="grid gap-1 text-xs text-wa-muted">Estado<Select defaultValue="nuevo"><option value="nuevo">Nuevo</option><option value="seguimiento">Seguimiento</option><option value="cerrado">Cerrado</option></Select></label>
        <label className="grid gap-1 text-xs text-wa-muted sm:col-span-2">Notas<Textarea rows={3} placeholder="Contexto para el equipo" /></label>
        <label className="flex items-center gap-2 text-sm"><Checkbox defaultChecked />Mostrar elementos activos</label>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold">Estados</h2>
        <div className="flex flex-wrap gap-2">
          <Badge variant="success">Activo</Badge><Badge variant="warning">Pendiente</Badge><Badge variant="danger">Error</Badge><Badge variant="info">Nuevo</Badge>
        </div>
        <div className="mt-4 space-y-2"><Skeleton className="h-4 w-2/3" /><Skeleton className="h-4 w-full" /><Skeleton className="h-16 w-full" /></div>
      </section>
    </Card>
  ),
}

export const EstadoVacio: Story = {
  render: () => (
    <Card className="w-[min(30rem,90vw)]">
      <EmptyState icon={Inbox} title="No hay resultados" description="Ajusta los filtros o crea el primer elemento." action={<Button size="sm">Crear elemento</Button>} />
    </Card>
  ),
}
