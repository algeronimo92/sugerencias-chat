export const meta = {
  name: 'debate-contrapartes',
  description: 'Cada especialista propone, su contraparte agnóstica intenta tumbarlo, el especialista replica y producto decide',
  whenToUse: 'Para decisiones de producto de CliniVentas donde importa que la propuesta resista a alguien sin solución favorita: métricas nuevas, qué dato guardar, cómo mostrarlo. Más caro que debate-expertos (un agente extra por especialista y ronda). Args: { tema, contexto?, especialistas?, rondas? }',
  phases: [
    { title: 'Propuestas', detail: 'análisis independiente por especialidad' },
    { title: 'Contrapartes', detail: 'una contraparte agnóstica por especialista busca dónde no se sostiene' },
    { title: 'Réplica', detail: 'cada especialista concede o sostiene con evidencia' },
    { title: 'Síntesis', detail: 'producto separa lo que resistió de lo que no y prioriza' },
  ],
}

// Uso: Workflow({ name: 'debate-contrapartes', args: { tema: '...', contexto: 'qué leer...', especialistas: ['datos', 'gerencia'], rondas: 1 } })
// Especialistas y contraparte son subagentes de .claude/agents/. La contraparte
// es una sola definición (contraparte-agnostica) instanciada una vez por
// especialista: lo que cambia entre ellas es a quién revisan, no las reglas.

const ALL = [
  { key: 'ui', agentType: 'disenador-ui', name: 'Especialista UI/UX', foco: 'jerarquía visual, densidad, consistencia con el panel actual, móvil, modo oscuro y estados vacío/carga/error' },
  { key: 'ux', agentType: 'investigador-ux', name: 'Investigador UX', foco: 'tareas reales por rol, frecuencia de uso, recorridos y descubribilidad' },
  { key: 'usabilidad', agentType: 'experto-usabilidad', name: 'Especialista en usabilidad', foco: 'heurísticas de Nielsen, carga cognitiva, vocabulario, accesibilidad y errores de interpretación probables' },
  { key: 'datos', agentType: 'analista-datos', name: 'Especialista en análisis de datos', foco: 'si la métrica está bien definida y no engaña, qué gráfico la cuenta mejor y qué hay que empezar a guardar' },
  { key: 'gerencia', agentType: 'experto-negocio-clinicas', name: 'Experto en decisiones de gerencia', foco: 'qué decisión toma la dueña con esto cada semana y cuánta plata cambia' },
  { key: 'frontend', agentType: 'desarrollador-frontend', name: 'Desarrollador frontend', foco: 'qué cuesta construirlo con lo que ya existe, qué se reutiliza, reglas de arquitectura y cómo se prueba' },
  { key: 'anuncios', agentType: 'experto-anuncios-meta', name: 'Experto en anuncios de Meta', foco: 'costo por lead, atribución y conversión por anuncio' },
]
const DEFAULT_KEYS = ['ui', 'usabilidad', 'datos', 'gerencia', 'frontend']

const input = args || {}
if (!input.tema) throw new Error('Falta args.tema: qué decisión o pantalla se debate')
const keys = input.especialistas || DEFAULT_KEYS
const roles = ALL.filter((r) => keys.includes(r.key))
if (roles.length < 2) throw new Error('Un debate necesita al menos dos especialistas de: ' + ALL.map((r) => r.key).join(', '))
const debateRounds = Math.max(1, Math.min(3, input.rondas || 1))

const BRIEF = `Tema del debate: ${input.tema}\n${input.contexto ? `\nContexto y qué leer:\n${input.contexto}\n` : ''}`
const READ_ONLY = 'Solo lees: no editas archivos, no corres el backend ni consultas ninguna base. Cada afirmación cita archivo:línea, un dato o una fuente. Escribes en español, en lenguaje de producto.'

// Un subagente definido en esta misma sesión puede no estar registrado todavía.
// En ese caso se corre con el agente por defecto y el rol va en el mensaje, para
// que el debate no pierda una silla por un detalle de registro.
async function ask(agentType, persona, prompt, opts) {
  try {
    return await agent(prompt, { ...opts, agentType })
  } catch (error) {
    log(`${opts.label}: "${agentType}" no está disponible (${error && error.message}); corre con el agente por defecto`)
    return agent(`${persona}\n${READ_ONLY}\n\n${prompt}`, opts)
  }
}

const specialistPersona = (r) => `Eres ${r.name} en un debate de producto de CliniVentas. Tu foco: ${r.foco}. No cubras las otras miradas, defiende bien la tuya.`
const counterPersona = (r) => `Eres la contraparte agnóstica de ${r.name}. Sabes de su especialidad (${r.foco}) tanto como esa persona, pero no tienes solución favorita: buscas supuestos sin probar, la alternativa más simple (incluida no hacer nada) y cómo la propuesta puede engañar o hacer daño. También dices qué sí se sostiene. No propones un diseño propio.`

const FIRST = {
  type: 'object',
  properties: {
    resumen: { type: 'string' },
    hallazgos: { type: 'array', items: { type: 'object', properties: {
      problema: { type: 'string' }, evidencia: { type: 'string' }, gravedad: { type: 'string', enum: ['alta', 'media', 'baja'] } },
      required: ['problema', 'evidencia', 'gravedad'] } },
    propuestas: { type: 'array', items: { type: 'object', properties: {
      id: { type: 'string' }, titulo: { type: 'string' }, que: { type: 'string' }, por_que: { type: 'string' },
      impacto: { type: 'string', enum: ['alto', 'medio', 'bajo'] }, esfuerzo: { type: 'string', enum: ['S', 'M', 'L'] },
      como_medirlo: { type: 'string' } },
      required: ['id', 'titulo', 'que', 'por_que', 'impacto', 'esfuerzo', 'como_medirlo'] } },
    recomendacion: { type: 'string' },
    preguntas_a_otros: { type: 'array', items: { type: 'string' } },
  },
  required: ['resumen', 'hallazgos', 'propuestas', 'recomendacion', 'preguntas_a_otros'],
}

const CHALLENGE = {
  type: 'object',
  properties: {
    supuestos_sin_probar: { type: 'array', items: { type: 'object', properties: {
      supuesto: { type: 'string' }, por_que_dudar: { type: 'string' }, como_comprobarlo: { type: 'string' } },
      required: ['supuesto', 'por_que_dudar', 'como_comprobarlo'] } },
    objeciones: { type: 'array', items: { type: 'object', properties: {
      propuesta: { type: 'string' }, objecion: { type: 'string' }, evidencia: { type: 'string' },
      alternativa_mas_simple: { type: 'string' }, gravedad: { type: 'string', enum: ['alta', 'media', 'baja'] } },
      required: ['propuesta', 'objecion', 'evidencia', 'alternativa_mas_simple', 'gravedad'] } },
    si_no_se_hace_nada: { type: 'string' },
    lo_que_si_se_sostiene: { type: 'array', items: { type: 'object', properties: { propuesta: { type: 'string' }, por_que: { type: 'string' } }, required: ['propuesta', 'por_que'] } },
    objeciones_retiradas: { type: 'array', items: { type: 'string' } },
  },
  required: ['supuestos_sin_probar', 'objeciones', 'si_no_se_hace_nada', 'lo_que_si_se_sostiene', 'objeciones_retiradas'],
}

const REPLY = {
  type: 'object',
  properties: {
    concedo: { type: 'array', items: { type: 'object', properties: { objecion: { type: 'string' }, que_cambio: { type: 'string' } }, required: ['objecion', 'que_cambio'] } },
    sostengo: { type: 'array', items: { type: 'object', properties: { objecion: { type: 'string' }, por_que: { type: 'string' }, evidencia: { type: 'string' } }, required: ['objecion', 'por_que', 'evidencia'] } },
    respuestas: { type: 'array', items: { type: 'object', properties: { pregunta: { type: 'string' }, respuesta: { type: 'string' } }, required: ['pregunta', 'respuesta'] } },
    top3: { type: 'array', items: { type: 'object', properties: { propuesta: { type: 'string' }, ajuste: { type: 'string' } }, required: ['propuesta', 'ajuste'] } },
    recomendacion: { type: 'string' },
    cambio_de_opinion: { type: 'string' },
  },
  required: ['concedo', 'sostengo', 'respuestas', 'top3', 'recomendacion', 'cambio_de_opinion'],
}

const tag = (results, field, suffix) => results
  .map((res, i) => res && { [field]: roles[i].name + suffix, ...res })
  .filter(Boolean)

phase('Propuestas')
const first = tag(await parallel(roles.map((r) => () => ask(
  r.agentType, specialistPersona(r),
  `${BRIEF}\nPrimera ronda. Analiza el tema desde tu especialidad, verificando en el código lo que afirmes. Entrega 4-8 hallazgos, 3-6 propuestas ordenadas por impacto (id con prefijo "${r.key}-"), tu recomendación en un párrafo (qué harías y qué no) y 1-3 preguntas para los otros especialistas: ${roles.map((x) => x.name).join(', ')}. Tu contraparte agnóstica va a intentar tumbar lo que propongas: deja a la vista de qué supuestos depende.`,
  { label: `Propone · ${r.name}`, phase: 'Propuestas', schema: FIRST },
))), 'especialista', '')
log(`Propuestas: ${first.length} de ${roles.length} especialistas entregaron`)

const rounds = []
for (let n = 0; n < debateRounds; n++) {
  // Barrera a propósito: cada contraparte lee todas las propuestas, porque una
  // objeción suele salir de comparar lo que dicen dos especialistas.
  phase('Contrapartes')
  const before = JSON.stringify({ propuestas: first, rondas: rounds }, null, 1)
  const challenges = tag(await parallel(roles.map((r) => () => ask(
    'contraparte-agnostica', counterPersona(r),
    `${BRIEF}\nEres la contraparte agnóstica de: ${r.name} (foco: ${r.foco}). Ronda ${n + 1}.\n\nEsto se dijo hasta ahora:\n${before}\n\nRevisa sobre todo lo que propuso ${r.name}; usa lo de los demás para contrastar. Abre el código y comprueba lo que afirma. Entrega supuestos sin probar, objeciones con evidencia y la alternativa más simple, qué pasa si no se hace nada, y lo que sí se sostiene.${n > 0 ? ' Si una réplica te convenció, retira la objeción y dilo.' : ''}`,
    { label: `Contraparte ${n + 1} · ${r.name}`, phase: 'Contrapartes', schema: CHALLENGE },
  ))), 'contraparte_de', '')
  log(`Contrapartes ${n + 1}: ${challenges.length} de ${roles.length} entregaron`)

  phase('Réplica')
  const after = JSON.stringify({ propuestas: first, rondas: rounds, contrapartes_esta_ronda: challenges }, null, 1)
  const replies = tag(await parallel(roles.map((r) => () => ask(
    r.agentType, specialistPersona(r),
    `${BRIEF}\nRéplica ${n + 1}. Esto dijeron todos, incluidas las contrapartes agnósticas:\n${after}\n\nResponde a tu contraparte y a las objeciones de las demás que toquen tu especialidad: concede lo que tengan razón y di qué cambias; sostén con evidencia del código lo que no. Responde las preguntas que te hicieron los otros especialistas. Cierra con tu top 3 revisado, tu recomendación final y qué cambió en tu postura.`,
    { label: `Réplica ${n + 1} · ${r.name}`, phase: 'Réplica', schema: REPLY },
  ))), 'especialista', '')
  log(`Réplica ${n + 1}: ${replies.length} de ${roles.length} especialistas respondieron`)
  rounds.push({ contrapartes: challenges, replicas: replies })
}

phase('Síntesis')
const report = await agent(
  `${BRIEF}\nPropuestas:\n${JSON.stringify(first, null, 1)}\n\nRondas de contraparte y réplica:\n${JSON.stringify(rounds, null, 1)}\n\nEscribe el informe final según tus instrucciones. En este debate cada especialista tuvo una contraparte agnóstica: separa lo que resistió las objeciones de lo que cayó o quedó sin responder, y no cuentes como consenso algo que solo nadie atacó. Máximo unas 1800 palabras.`,
  { label: 'Síntesis · Producto', phase: 'Síntesis', agentType: 'moderador-producto' },
)
return { report, propuestas: first, rondas: rounds }
