export const meta = {
  name: 'debate-expertos',
  description: 'Especialistas de producto (UX, UI, usabilidad, negocio, anuncios, datos) debaten un tema en rondas y producto sintetiza un plan',
  whenToUse: 'Para decisiones de producto de CliniVentas que conviene mirar desde varias especialidades antes de implementar: rediseños, métricas nuevas, funciones para la dueña, anuncios. Args: { tema, contexto?, especialistas?, rondas? }',
  phases: [
    { title: 'Ronda 1', detail: 'análisis independiente por especialidad' },
    { title: 'Debate', detail: 'cada especialista lee a los demás y discute' },
    { title: 'Síntesis', detail: 'producto separa consensos y disensos y prioriza' },
  ],
}

// Uso: Workflow({ name: 'debate-expertos', args: { tema: '...', contexto: 'qué leer...', especialistas: ['ux', 'negocio'], rondas: 2 } })
// Los especialistas son los subagentes de .claude/agents/; cada uno trae su foco
// y las reglas del debate (solo lectura, evidencia, apoyar u objetar con razones).

const ALL = [
  { key: 'ux', agentType: 'investigador-ux', name: 'Investigador UX' },
  { key: 'ui', agentType: 'disenador-ui', name: 'Diseñador UI' },
  { key: 'usabilidad', agentType: 'experto-usabilidad', name: 'Experto en usabilidad' },
  { key: 'negocio', agentType: 'experto-negocio-clinicas', name: 'Experto en el negocio de clínicas' },
  { key: 'anuncios', agentType: 'experto-anuncios-meta', name: 'Experto en anuncios de Meta' },
  { key: 'datos', agentType: 'analista-datos', name: 'Analista de datos' },
]

const input = args || {}
if (!input.tema) throw new Error('Falta args.tema: qué decisión o pantalla se debate')
const roles = input.especialistas ? ALL.filter((r) => input.especialistas.includes(r.key)) : ALL
if (roles.length < 2) throw new Error('Un debate necesita al menos dos especialistas de: ' + ALL.map((r) => r.key).join(', '))
const debateRounds = Math.max(1, Math.min(3, input.rondas || 1))

const BRIEF = `Tema del debate: ${input.tema}\n${input.contexto ? `\nContexto y qué leer:\n${input.contexto}\n` : ''}`

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
    preguntas_a_otros: { type: 'array', items: { type: 'string' } },
  },
  required: ['resumen', 'hallazgos', 'propuestas', 'preguntas_a_otros'],
}

const REPLY = {
  type: 'object',
  properties: {
    apoyo: { type: 'array', items: { type: 'object', properties: { propuesta: { type: 'string' }, por_que: { type: 'string' } }, required: ['propuesta', 'por_que'] } },
    objeciones: { type: 'array', items: { type: 'object', properties: { propuesta: { type: 'string' }, objecion: { type: 'string' }, alternativa: { type: 'string' } }, required: ['propuesta', 'objecion', 'alternativa'] } },
    respuestas: { type: 'array', items: { type: 'object', properties: { pregunta: { type: 'string' }, respuesta: { type: 'string' } }, required: ['pregunta', 'respuesta'] } },
    top3: { type: 'array', items: { type: 'object', properties: { propuesta: { type: 'string' }, ajuste: { type: 'string' } }, required: ['propuesta', 'ajuste'] } },
    cambio_de_opinion: { type: 'string' },
  },
  required: ['apoyo', 'objeciones', 'respuestas', 'top3', 'cambio_de_opinion'],
}

const tag = (results) => results.map((res, i) => res && { especialista: roles[i].name, ...res }).filter(Boolean)

phase('Ronda 1')
const first = tag(await parallel(roles.map((r) => () => agent(
  `${BRIEF}\nPrimera ronda. Analiza el tema desde tu especialidad. Entrega 4-8 hallazgos y 3-6 propuestas ordenadas por impacto (id con prefijo "${r.key}-"), y 1-3 preguntas para los otros especialistas: ${roles.map((x) => x.name).join(', ')}.`,
  { label: `R1 · ${r.name}`, phase: 'Ronda 1', agentType: r.agentType, schema: FIRST },
))))
log(`Ronda 1: ${first.length} de ${roles.length} especialistas entregaron`)

const rounds = []
for (let n = 0; n < debateRounds; n++) {
  phase('Debate')
  const history = JSON.stringify({ ronda_1: first, debate: rounds }, null, 1)
  const reply = tag(await parallel(roles.map((r) => () => agent(
    `${BRIEF}\nRonda de debate ${n + 1}. Esto dijeron todos hasta ahora:\n${history}\n\nApoya, objeta con alternativa, responde lo que te preguntaron, da tu top 3 revisado y di qué cambió en tu postura. Verifica en el código lo que discutas.`,
    { label: `Debate ${n + 1} · ${r.name}`, phase: 'Debate', agentType: r.agentType, schema: REPLY },
  ))))
  rounds.push(reply)
  log(`Debate ${n + 1}: ${reply.length} de ${roles.length} especialistas respondieron`)
}

phase('Síntesis')
const report = await agent(
  `${BRIEF}\nRonda 1:\n${JSON.stringify(first, null, 1)}\n\nDebate:\n${JSON.stringify(rounds, null, 1)}\n\nEscribe el informe final según tus instrucciones. Máximo unas 1500 palabras.`,
  { label: 'Síntesis · Producto', phase: 'Síntesis', agentType: 'moderador-producto' },
)
return { report, ronda_1: first, debate: rounds }
