import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NoticeSettings } from '../types'
import { previewNotice, renderParameter, templateVariables } from '../domain/notice'
import { NoticeCard } from './NoticeCard'

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() }))

vi.mock('../../../shared/http/client', () => ({ default: api }))

const settings: NoticeSettings = {
  enabled: true,
  template_id: 7,
  parameters: ['{nombre_completo}', '{fecha_larga} a las {hora_12h}'],
  fields: [
    { key: 'nombre_completo', label: 'Contacto', group: 'cita' },
    { key: 'fecha_larga', label: 'Fecha larga', group: 'cita' },
    { key: 'hora_12h', label: 'Hora (01:00 Pm)', group: 'cita' },
    { key: 'lead.nombre', label: 'Nombre en el CRM', group: 'lead' },
  ],
  templates: [{ id: 7, name: 'confirmacion_cita', content: 'Hola {{1}}, te esperamos el {{2}}.', variable_count: 2, suggested_parameters: ['{lead.nombre}', '{fecha}'] }],
  preview: {
    label: 'AYME · Hifu12D',
    values: { nombre_completo: 'AYME', fecha_larga: 'JUEVES 12 de Noviembre', hora_12h: '01:00 Pm', 'lead.nombre': 'Ayme Torres' },
  },
}

function renderCard(data: NoticeSettings, audience: 'client' | 'staff' = 'client') {
  api.get.mockResolvedValue({ data })
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <NoticeCard audience={audience} />
    </QueryClientProvider>,
  )
}

async function openConfiguration() {
  await userEvent.click(await screen.findByRole('button', { name: 'Configuración del aviso' }))
}

describe('NoticeCard', () => {
  beforeEach(() => {
    api.get.mockReset()
    api.put.mockReset()
  })

  it('lee las variables en orden y sin repetir', () => {
    expect(templateVariables('{{1}} y {{ 2 }} y {{1}}')).toEqual(['1', '2'])
    expect(templateVariables('Hola {{cliente}}')).toEqual(['cliente'])
  })

  it('resuelve una variable armada con datos reales, o por nombre si no hay citas', () => {
    const labels = new Map([['fecha', 'Fecha'], ['dni', 'DNI']])
    expect(renderParameter('{fecha} a las 10', labels, { fecha: '12/11/2026' })).toBe('12/11/2026 a las 10')
    expect(renderParameter('DNI {dni}', labels, { dni: '' })).toBe('-')
    expect(renderParameter('{fecha}', labels)).toBe('[Fecha]')
    expect(previewNotice('Hola {{1}}, el {{2}}', ['Ana', ''])).toBe('Hola Ana, el {{2}}')
  })

  it('muestra el mensaje con los datos de la última cita', async () => {
    renderCard(settings)
    await openConfiguration()

    expect(await screen.findByText('Hola AYME, te esperamos el JUEVES 12 de Noviembre a las 01:00 Pm.')).toBeInTheDocument()
    expect(screen.getByText(/última cita: AYME · Hifu12D/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Nombre en el CRM/ })).toBeInTheDocument()
  })

  it('sumar un dato tocándolo lo agrega a la variable marcada', async () => {
    renderCard(settings)
    api.put.mockResolvedValue({ data: settings })
    await openConfiguration()

    await screen.findByRole('group', { name: 'Variable {{1}}' })
    await userEvent.click(screen.getByRole('button', { name: /Nombre en el CRM/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Guardar aviso' }))

    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/api/appointments/notices/client', {
      enabled: true, template_id: 7, parameters: ['{nombre_completo} {lead.nombre}', '{fecha_larga} a las {hora_12h}'],
    }))
  })

  it('explica cómo activarlo cuando no hay plantillas aprobadas', async () => {
    renderCard({ ...settings, enabled: false, template_id: null, parameters: [], templates: [] })

    expect(await screen.findByText(/plantilla oficial de categoría Utilidad/)).toBeInTheDocument()
  })

  it('el aviso al equipo se guarda aparte y explica a quién le llega', async () => {
    renderCard(settings, 'staff')
    api.put.mockResolvedValue({ data: { ...settings, enabled: false } })

    expect(await screen.findByRole('region', { name: /Aviso de venta al equipo/ })).toBeInTheDocument()
    await openConfiguration()
    expect(await screen.findByText(/teléfono cargado en Usuarios/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('checkbox'))
    await userEvent.click(screen.getByRole('button', { name: 'Guardar aviso' }))

    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/api/appointments/notices/staff', expect.objectContaining({ enabled: false })))
  })

  it('al elegir una plantilla arranca con las variables armadas en Plantillas', async () => {
    renderCard({ ...settings, template_id: null, parameters: [] })
    api.put.mockResolvedValue({ data: settings })

    await userEvent.click(await screen.findByRole('checkbox'))
    await openConfiguration()
    await userEvent.click(screen.getByRole('combobox'))
    await userEvent.click(await screen.findByRole('option', { name: 'confirmacion_cita' }))

    // {fecha} no tiene valor en la última cita: sale "-", como al enviar.
    expect(await screen.findByText('Hola Ayme Torres, te esperamos el -.')).toBeInTheDocument()
  })

  it('mantiene la configuración adicional plegada por defecto', async () => {
    renderCard(settings)

    const disclosure = await screen.findByRole('button', { name: 'Configuración del aviso' })
    expect(disclosure).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('checkbox')).toBeVisible()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.queryByText(/Hola AYME/)).not.toBeInTheDocument()

    await userEvent.click(disclosure)

    expect(disclosure).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('combobox')).toBeVisible()
    expect(screen.getByText(/Hola AYME/)).toBeVisible()
  })
})
