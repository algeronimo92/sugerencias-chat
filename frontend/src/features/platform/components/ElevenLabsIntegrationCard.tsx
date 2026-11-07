import { ElevenLabsMark } from '../../../shared/ui/BrandMarks'
import { useEffect, useMemo, useState } from 'react'
import { IntegrationCard, IntegrationDisclosure } from '../../../shared/ui/IntegrationCard'
import { useSettings } from '../hooks/useSettings'
import { IntegrationSettingsForm } from './IntegrationSettingsForm'

const GROUP = 'elevenlabs'
const API_KEY = 'elevenlabs_api_key'

/** Se configura una vez: los ajustes van plegados salvo mientras falte la clave. */
export function ElevenLabsIntegrationCard() {
  const { data: settings = [] } = useSettings(true)
  const items = useMemo(() => settings.filter(item => item.group === GROUP), [settings])
  const configured = items.some(item => item.key === API_KEY && item.configured)
  const [open, setOpen] = useState(false)
  const [touched, setTouched] = useState(false)
  useEffect(() => {
    if (!touched && items.length > 0) setOpen(!configured)
  }, [configured, items.length, touched])

  return (
    <IntegrationCard
      id="voz"
      icon={ElevenLabsMark}
      title="ElevenLabs"
      description="Convierte las sugerencias del asistente en audios con la voz del negocio."
      state={configured ? 'connected' : 'unconfigured'}
    >
      <IntegrationDisclosure id="voz-settings" title="Ajustes de voz" open={open} onToggle={() => { setTouched(true); setOpen(value => !value) }}>
        <IntegrationSettingsForm items={items} />
      </IntegrationDisclosure>
    </IntegrationCard>
  )
}
