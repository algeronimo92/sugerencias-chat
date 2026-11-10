import { parseContent } from '../../whatsapp/public/message'
import { META_CONTRACT } from '../../whatsapp/public/metaContract'

/** Nombres propios donde el nombre genérico del chat se repite: «Respuesta»
 *  servía para `button` y `interactive/button_reply`, y «No soportado por
 *  WhatsApp» para `unknown` y `unsupported`. Antes la opción llevaba el código
 *  entre paréntesis («Respuesta (interactive/button_reply)») para distinguirlas. */
const OWN_LABELS: Record<string, string> = {
  button: 'Respuesta a botón de plantilla',
  'interactive/button_reply': 'Respuesta a botón',
  'interactive/list_reply': 'Opción de una lista',
  'interactive/nfm_reply': 'Formulario completado',
  unknown: 'Tipo desconocido',
}

/** Tipos de mensaje entrante para la condición «El mensaje es de tipo».
 *  `interactive` no se ofrece sola: el backend compara contra el subtipo,
 *  que es lo que separa tocar un botón de completar un formulario. */
export const INBOUND_MESSAGE_TYPE_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  ...META_CONTRACT.inbound.root_types
    .filter(root => root !== 'interactive')
    .map(root => ({ root, subtype: null as string | null })),
  ...META_CONTRACT.inbound.subtypes.interactive.map(subtype => ({ root: 'interactive', subtype })),
].map(({ root, subtype }) => {
  const value = subtype ? `${root}/${subtype}` : root
  if (Object.hasOwn(OWN_LABELS, value)) return { value, label: OWN_LABELS[value] }
  const label = root === 'text' ? 'Texto' : parseContent({ content: null, message_type: root, message_subtype: subtype }).label
  return { value, label }
})
