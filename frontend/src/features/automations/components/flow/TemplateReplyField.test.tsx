import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { MessageTemplate } from '../../../templates/types'
import { newTemplateReply } from '../../domain/templateReply'
import { TemplateReplyField } from './TemplateReplyField'

const meta = (...texts: string[]) => ({
  id: 1, template_type: 'official', official_buttons: texts.map(text => ({ type: 'quick_reply', text })),
}) as MessageTemplate

describe('TemplateReplyField', () => {
  it('no aparece si la plantilla no tiene botones de respuesta rápida', () => {
    const { container } = render(<TemplateReplyField template={meta()} reply={undefined} onChange={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('apagado dice para qué botones sirve, y al marcarlo arma las salidas con 24 horas de espera', async () => {
    const onChange = vi.fn()
    render(<TemplateReplyField template={meta('Sí, quiero', 'No, gracias')} reply={undefined} onChange={onChange} />)

    const toggle = screen.getByRole('checkbox', { name: /Seguir según el botón que toque/ })
    expect(toggle).not.toBeChecked()
    expect(screen.getByText(/«Sí, quiero», «No, gracias»/)).toBeInTheDocument()
    expect(screen.queryByText('Tiempo máximo para responder')).not.toBeInTheDocument()

    await userEvent.click(toggle)
    expect(onChange).toHaveBeenCalledWith(newTemplateReply(['Sí, quiero', 'No, gracias']))
  })

  it('encendido muestra el tiempo máximo y al desmarcarlo vuelve a «Siguiente»', async () => {
    const onChange = vi.fn()
    render(
      <TemplateReplyField template={meta('Sí')} reply={newTemplateReply(['Sí'])} onChange={onChange}>
        <span>campo de tiempo</span>
      </TemplateReplyField>,
    )

    expect(screen.getByText('Tiempo máximo para responder')).toBeInTheDocument()
    expect(screen.getByText('campo de tiempo')).toBeInTheDocument()
    // El plazo queda ligado a la salida que dispara.
    expect(screen.getByText('Si el cliente no responde en este tiempo, el paso sigue por «Sin respuesta».')).toBeInTheDocument()
    expect(screen.getByText(/«Otra respuesta» es cuando escribe en vez de tocar un botón/)).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('checkbox', { name: /Seguir según el botón que toque/ }))
    expect(onChange).toHaveBeenCalledWith(undefined)
  })

  it('si la plantilla cambió sus botones lo avisa y los actualiza conservando el tiempo', async () => {
    const onChange = vi.fn()
    render(<TemplateReplyField template={meta('Sí', 'Tal vez')} reply={newTemplateReply(['Sí', 'No'], 7200)} onChange={onChange} />)

    expect(screen.getByRole('alert')).toHaveTextContent('Los botones de la plantilla cambiaron')
    await userEvent.click(screen.getByRole('button', { name: 'Actualizar botones' }))
    expect(onChange).toHaveBeenCalledWith(newTemplateReply(['Sí', 'Tal vez'], 7200))
  })

  it('si la plantilla se quedó sin botones pide apagarlo o elegir otra', () => {
    render(<TemplateReplyField template={meta()} reply={newTemplateReply(['Sí'])} onChange={vi.fn()} />)

    expect(screen.getByRole('alert')).toHaveTextContent('ya no tiene botones de respuesta rápida')
    expect(screen.queryByRole('button', { name: 'Actualizar botones' })).not.toBeInTheDocument()
  })
})
