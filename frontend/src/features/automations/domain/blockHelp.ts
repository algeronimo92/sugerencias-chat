import { AutomationActionType, FlowNodeType } from './automationCatalog'

/**
 * La explicación de cada bloque del flujo, que se abre con el botón «?» del
 * panel de propiedades (2026-11-18).
 *
 * Antes cada bloque mostraba estos párrafos siempre abiertos: unos 20 en
 * total, varios de más de 120 caracteres, en cajas de colores que competían
 * con los campos. Quien ya sabe usar el bloque los releía cada vez; quien no,
 * los encuentra acá con un clic. Lo que evita un error en el momento (un
 * flujo sin publicar, una plantilla que ya no sirve) sigue a la vista en el
 * bloque.
 */
const WINDOW_LINE = 'Solo se envía si el cliente escribió en las últimas 24 horas.'

const NODE_HELP: Partial<Record<string, string[]>> = {
  [FlowNodeType.Condition]: [
    'En cada salida deben cumplirse todas sus condiciones (Y).',
    'Las salidas se revisan en orden (O) y el lead sale por la primera que se cumpla.',
    'Los mensajes se comparan con el texto que inició o reanudó la automatización, sin importar mayúsculas, tildes ni espacios repetidos.',
  ],
  [FlowNodeType.WaitAny]: [
    'El lead sigue por la salida de lo que pase primero.',
    'Conecta cada condición. Si el temporizador queda sin conectar, ahí termina la automatización.',
  ],
  [FlowNodeType.Question]: [
    'Conecta cada botón, «Otra respuesta» y «Sin respuesta» a su propia salida.',
    '«Mandó una foto» es opcional: si no la conectas, una foto sale por «Otra respuesta».',
    'Si los botones no se pueden mostrar, la pregunta llega con las opciones numeradas.',
    WINDOW_LINE,
  ],
  [FlowNodeType.RoundRobin]: [
    'Cada lead sale por la siguiente salida; después de la última vuelve a la primera.',
    'El turno se comparte entre todos los leads y se mantiene aunque vuelvas a publicar.',
    'Conecta todas las salidas. El nombre solo sirve para ubicarla en el lienzo.',
  ],
  [FlowNodeType.InvokeFlow]: [
    'La otra automatización empieza para el mismo lead.',
    'Esta no la espera: sigue de inmediato por su salida, que normalmente conectas a un Fin.',
  ],
  [FlowNodeType.End]: [
    '«Cerrar conversación» marca el chat como cerrado cuando un lead llega a este Fin.',
  ],
}

const ACTION_HELP: Partial<Record<string, string[]>> = {
  [AutomationActionType.SendTemplate]: [
    'Las plantillas internas pueden llevar archivos. ' + WINDOW_LINE,
    'Las de Meta aprobadas se envían aunque el cliente no haya escrito, y Meta cobra cada envío.',
    'Si un dato del lead que usa la plantilla está vacío, el paso falla.',
    'Si la plantilla de Meta tiene botones de respuesta rápida, «Seguir según el botón que toque» da una salida por botón, más «Otra respuesta» y «Sin respuesta».',
  ],
  [AutomationActionType.SendMessage]: [WINDOW_LINE],
  [AutomationActionType.SendAudio]: [WINDOW_LINE],
  [AutomationActionType.SendAttachment]: [WINDOW_LINE],
  [AutomationActionType.SendMedia]: [
    'En imágenes, videos y documentos el texto va junto al archivo; en audios llega como mensaje aparte.',
    WINDOW_LINE,
  ],
  [AutomationActionType.ChangeService]: [
    'Es el tratamiento que le interesa al lead. Déjalo vacío para quitar el actual.',
    'Para marcar de qué anuncio vino, usa «Agregar etiqueta».',
  ],
  [AutomationActionType.SetConversationState]: [
    'Abrirla desde aquí no inicia las automatizaciones de «Conversación nueva»: esas solo empiezan con un mensaje del cliente.',
  ],
}

export const ENTRY_CONDITIONS_HELP = [
  'La automatización solo empieza si el lead cumple todas estas condiciones.',
  'Para separar rutas dentro de la automatización, usa un paso Condición.',
]

export function blockHelp(nodeType: string, actionType?: string): string[] {
  if (nodeType === FlowNodeType.Action) return (actionType && ACTION_HELP[actionType]) || []
  return NODE_HELP[nodeType] ?? []
}

/** Las acciones con un campo de texto donde sirven las variables del lead. */
export const TEXT_ACTIONS = new Set<string>([
  AutomationActionType.SendMessage,
  AutomationActionType.SendMedia,
  AutomationActionType.CreateTask,
  AutomationActionType.Notify,
])
