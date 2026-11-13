import { WhatsAppMark } from '../../../shared/ui/BrandMarks'
import { useMemo, useState } from 'react'
import { IntegrationCard, IntegrationDisclosure } from '../../../shared/ui/IntegrationCard'
import { useSettings } from '../hooks/useSettings'
import { useWhatsappStatus } from '../hooks/useWhatsapp'
import { IntegrationSettingsForm } from './IntegrationSettingsForm'
import { WhatsappPanel } from './WhatsappPanel'

const META_GROUP = 'meta'

/** Sin WhatsApp no hay CRM: es la primera tarjeta y la única resaltada en el primer uso. */
export function WhatsappIntegrationCard({ highlight = false }: { highlight?: boolean }) {
  const { data: status } = useWhatsappStatus()
  const { data: settings = [] } = useSettings(true)
  const keys = useMemo(() => settings.filter(item => item.group === META_GROUP), [settings])
  const connected = status?.state === 'open'
  const [keysOpen, setKeysOpen] = useState(false)

  return (
    <IntegrationCard
      id="whatsapp"
      icon={WhatsAppMark}
      title="WhatsApp"
      state={status ? (connected ? 'connected' : 'unconfigured') : 'unconfigured'}
      stateLabel={connected && status?.instance ? `Conectado · ${status.instance}` : undefined}
      highlight={highlight && !connected}
    >
      <div className="space-y-4">
        <WhatsappPanel onGoToClaves={() => setKeysOpen(true)} />
        <IntegrationDisclosure
          id="whatsapp-keys"
          title={connected ? 'Claves y catálogo de Meta' : 'Configurar con claves a mano'}
          open={keysOpen}
          onToggle={() => setKeysOpen(open => !open)}
        >
          <IntegrationSettingsForm items={keys} />
        </IntegrationDisclosure>
      </div>
    </IntegrationCard>
  )
}
