import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { IssueReportDialog } from './IssueReportDialog'


const mocks = vi.hoisted(() => ({
  mutate: vi.fn(),
  capture: vi.fn(),
}))

vi.mock('html2canvas', () => ({ default: mocks.capture }))
vi.mock('../hooks/useIssueReports', () => ({
  useCreateIssueReport: () => ({ mutate: mocks.mutate, isPending: false }),
}))

describe('IssueReportDialog', () => {
  beforeEach(() => {
    mocks.mutate.mockReset()
    mocks.capture.mockReset()
  })

  it('captura la vista de DermicaPro sin incluir el modal', async () => {
    const user = userEvent.setup()
    const canvas = {
      toBlob: (callback: (blob: Blob) => void) => callback(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' })),
    }
    mocks.capture.mockResolvedValue(canvas)
    render(<>
      <div data-issue-capture-root style={{ width: 800, height: 600 }}>Vista actual</div>
      <IssueReportDialog open currentPath="/tasks" leadId={null} onClose={vi.fn()} />
    </>)

    await user.click(screen.getByRole('button', { name: 'Capturar pantalla' }))

    await waitFor(() => expect(mocks.capture).toHaveBeenCalledTimes(1))
    expect(mocks.capture.mock.calls[0][0]).toHaveAttribute('data-issue-capture-root')
    expect(await screen.findByAltText(/^captura-dermicapro-/)).toBeInTheDocument()
  })

  it('envía el contexto actual y una evidencia seleccionada', async () => {
    const user = userEvent.setup()
    render(
      <IssueReportDialog
        open
        currentPath="/chat/9cc06f7e-105f-45a6-8bc8-88223051355e"
        leadId="9cc06f7e-105f-45a6-8bc8-88223051355e"
        onClose={vi.fn()}
      />,
    )

    await user.type(screen.getByLabelText('Título *'), 'No puedo enviar')
    await user.type(screen.getByLabelText('Descripción *'), 'El botón queda cargando y nunca termina.')

    const file = new File([new Uint8Array([1, 2, 3])], 'captura.png', { type: 'image/png' })
    const upload = document.querySelector<HTMLInputElement>('input[type="file"][multiple]')
    expect(upload).not.toBeNull()
    fireEvent.change(upload!, { target: { files: [file] } })
    await screen.findByAltText('captura.png')

    await user.click(screen.getByRole('button', { name: 'Enviar reporte' }))

    await waitFor(() => expect(mocks.mutate).toHaveBeenCalledTimes(1))
    const [payload] = mocks.mutate.mock.calls[0]
    expect(payload.currentPath).toBe('/chat/9cc06f7e-105f-45a6-8bc8-88223051355e')
    expect(payload.leadId).toBe('9cc06f7e-105f-45a6-8bc8-88223051355e')
    expect(payload.attachments).toHaveLength(1)
    expect(payload.attachments[0]).toMatchObject({ contentType: 'image/png', filename: 'captura.png' })
  })

  it('impide enviar una descripción demasiado corta', async () => {
    const user = userEvent.setup()
    render(<IssueReportDialog open currentPath="/tasks" leadId={null} onClose={vi.fn()} />)

    await user.type(screen.getByLabelText('Título *'), 'Falla al guardar')
    await user.type(screen.getByLabelText('Descripción *'), 'Falla')

    expect(screen.getByRole('button', { name: 'Enviar reporte' })).toBeDisabled()
    expect(mocks.mutate).not.toHaveBeenCalled()
  })
})
