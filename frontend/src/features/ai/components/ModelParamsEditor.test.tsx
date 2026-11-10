import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { AiModelParams } from '../types'
import { ModelParamsEditor } from './ModelParamsEditor'

const GPT5: AiModelParams = {
  label: 'GPT-5.6 Terra', note: '', context_window: 1_050_000, max_output_tokens: 128_000,
  params: [
    { name: 'reasoning', kind: 'choice', label: 'Razonamiento', help: '', choices: ['none', 'low', 'medium'], min: null, max: null, default: 'low', requires: {} },
    { name: 'temperature', kind: 'float', label: 'Temperatura', help: '', choices: [], min: 0, max: 2, default: null, requires: { reasoning: ['none'] } },
    { name: 'max_output_tokens', kind: 'int', label: 'Máximo de tokens de salida', help: '', choices: [], min: 256, max: 128000, default: 8000, requires: {} },
  ],
}
const GPT41: AiModelParams = {
  label: 'GPT-4.1 mini', note: '', context_window: 1_047_576, max_output_tokens: 32_768,
  params: [
    { name: 'temperature', kind: 'float', label: 'Temperatura', help: '', choices: [], min: 0, max: 2, default: null, requires: {} },
    { name: 'stop', kind: 'text_list', label: 'Secuencias de corte', help: '', choices: [], min: null, max: 4, default: null, requires: {} },
  ],
}

async function openEditor(schema: AiModelParams, overrides = {}, onSave = vi.fn()) {
  const user = userEvent.setup()
  render(<ModelParamsEditor title="Modelo principal" schema={schema} overrides={overrides} disabled={false} onSave={onSave} />)
  return { user, onSave }
}

describe('ModelParamsEditor', () => {
  it('arma el formulario desde el esquema del modelo y deshabilita lo que depende de otro parámetro', async () => {
    await openEditor(GPT5)

    expect(screen.getByLabelText('Máximo de tokens de salida')).toHaveAttribute('placeholder', 'Por defecto: 8000')
    expect(screen.getByText('Entre 256 y 128000.')).toBeInTheDocument()
    // En gpt-5.x la temperatura solo aplica con razonamiento 'none' (el default es 'low').
    expect(screen.getByLabelText('Temperatura')).toBeDisabled()
    expect(screen.getByText("Solo con razonamiento 'none'.")).toBeInTheDocument()
  })

  it('guarda solo lo que se tocó, con el tipo correcto; lo vacío vuelve al default', async () => {
    const { user, onSave } = await openEditor(GPT41, { temperature: 0.9 })

    const temperature = screen.getByLabelText('Temperatura')
    expect(temperature).toHaveValue('0.9')
    await user.clear(temperature)
    await user.type(temperature, '0.3')
    await user.type(screen.getByLabelText('Secuencias de corte'), 'FIN, ###')
    await user.click(screen.getByRole('button', { name: 'Guardar ajustes' }))

    expect(onSave).toHaveBeenCalledWith({ temperature: 0.3, stop: ['FIN', '###'] })
  })

  it('vuelve a los valores por defecto', async () => {
    const { user, onSave } = await openEditor(GPT41, { temperature: 0.9 })
    expect(screen.getByText('1 ajuste personalizado')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Volver a los valores por defecto/ }))

    expect(onSave).toHaveBeenCalledWith({})
  })
})
