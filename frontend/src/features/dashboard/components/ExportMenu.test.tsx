import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ExportMenu } from './ExportMenu'

const download = vi.fn()
const toastError = vi.fn()

vi.mock('../api', () => ({
  downloadDashboardExport: (...args: unknown[]) => download(...args),
}))

vi.mock('sonner', () => ({ toast: { error: (...args: unknown[]) => toastError(...args) } }))

beforeEach(() => {
  download.mockReset()
  toastError.mockReset()
  URL.createObjectURL = vi.fn(() => 'blob:archivo')
  URL.revokeObjectURL = vi.fn()
})

async function openMenu() {
  await userEvent.click(screen.getByRole('button', { name: /Exportar/ }))
  return screen.getAllByRole('menuitem').map((item) => item.textContent ?? '')
}

describe('ExportMenu', () => {
  it('shows an admin every report and downloads the chosen one for the period', async () => {
    download.mockResolvedValue({ blob: new Blob(['x']), filename: 'separaciones-90-dias-2026-11-14.xlsx' })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    render(<ExportMenu isAdmin days={90} />)

    const items = await openMenu()
    expect(items).toHaveLength(4)
    expect(items.join(' ')).toContain('Respaldo completo')
    expect(screen.getByText(/últimos 90 días/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('menuitem', { name: /Separaciones y adelantos/ }))

    expect(download).toHaveBeenCalledWith('separaciones', 90)
    await waitFor(() => expect(click).toHaveBeenCalled())
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    click.mockRestore()
  })

  it('offers an analyst only the numbers, without the patient lists', async () => {
    render(<ExportMenu isAdmin={false} days={30} />)

    const items = await openMenu()
    expect(items).toHaveLength(2)
    expect(items.join(' ')).not.toMatch(/Leads del período|Respaldo/)
    expect(screen.getByText(/sin teléfonos ni DNI/)).toBeInTheDocument()
  })

  it('tells the user when the download fails and keeps the menu open', async () => {
    download.mockRejectedValue(new Error('403'))
    render(<ExportMenu isAdmin days={30} />)

    await openMenu()
    await userEvent.click(screen.getByRole('menuitem', { name: /Resultados por vendedora/ }))

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('No se pudo exportar "Resultados por vendedora". Intenta de nuevo.'))
    expect(screen.getByRole('menu')).toBeInTheDocument()
  })
})
