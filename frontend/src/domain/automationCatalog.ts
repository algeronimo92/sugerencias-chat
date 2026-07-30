type ValueOf<T> = T[keyof T]

export const AutomationTrigger = {
  LeadCreated: 'lead_created',
  StageChanged: 'stage_changed',
  MessageReceived: 'message_received',
  SellerResponseOverdue: 'seller_response_overdue',
  CustomerResponseOverdue: 'customer_response_overdue',
  TaskDue: 'task_due',
  Manual: 'manual',
} as const
export type AutomationTriggerValue = ValueOf<typeof AutomationTrigger>

export const AUTOMATION_TRIGGERS = [
  { value: AutomationTrigger.LeadCreated, label: 'Lead nuevo', description: 'Cuando se registra un contacto por primera vez.' },
  { value: AutomationTrigger.StageChanged, label: 'Cambio de etapa', description: 'Cuando una persona o el agente mueve el lead.' },
  { value: AutomationTrigger.MessageReceived, label: 'Mensaje recibido', description: 'Cuando llega un nuevo mensaje del cliente.' },
  { value: AutomationTrigger.SellerResponseOverdue, label: 'Vendedor sin responder', description: 'El último mensaje es del cliente y vence el tiempo configurado.' },
  { value: AutomationTrigger.CustomerResponseOverdue, label: 'Cliente sin responder', description: 'El último mensaje es del vendedor y vence el tiempo configurado.' },
  { value: AutomationTrigger.TaskDue, label: 'Tarea vencida', description: 'Cuando una tarea pendiente llega a su fecha límite.' },
  { value: AutomationTrigger.Manual, label: 'Inicio manual (vendedor)', description: 'El vendedor lo dispara con el botón "Iniciar flujo" dentro del chat de un lead.' },
] as const satisfies ReadonlyArray<{
  value: AutomationTriggerValue
  label: string
  description: string
}>

export const RESPONSE_OVERDUE_TRIGGERS: ReadonlySet<AutomationTriggerValue> = new Set([
  AutomationTrigger.SellerResponseOverdue,
  AutomationTrigger.CustomerResponseOverdue,
])

export const AutomationActionType = {
  CreateTask: 'create_task',
  AssignSeller: 'assign_seller',
  AddTag: 'add_tag',
  RemoveTag: 'remove_tag',
  ChangeStage: 'change_stage',
  Notify: 'notify',
  SendTemplate: 'send_template',
  SendMessage: 'send_message',
  ChangeService: 'change_service',
  SendAudio: 'send_audio',
  SendAttachment: 'send_attachment',
} as const
export type AutomationActionTypeValue = ValueOf<typeof AutomationActionType>

export const AUTOMATION_ACTION_LABELS = {
  [AutomationActionType.CreateTask]: 'Crear tarea',
  [AutomationActionType.AssignSeller]: 'Asignar vendedor',
  [AutomationActionType.AddTag]: 'Agregar etiqueta',
  [AutomationActionType.RemoveTag]: 'Quitar etiqueta',
  [AutomationActionType.ChangeStage]: 'Cambiar etapa',
  [AutomationActionType.Notify]: 'Notificar internamente',
  [AutomationActionType.SendTemplate]: 'Enviar plantilla WhatsApp',
  [AutomationActionType.SendMessage]: 'Enviar mensaje directo',
  [AutomationActionType.ChangeService]: 'Cambiar/quitar servicio de interés',
  [AutomationActionType.SendAudio]: 'Enviar audio',
  [AutomationActionType.SendAttachment]: 'Enviar solo adjunto',
} satisfies Record<AutomationActionTypeValue, string>

export const FlowNodeType = {
  Trigger: 'trigger',
  Condition: 'condition',
  Action: 'action',
  Wait: 'wait',
  WaitAny: 'wait_any',
  Question: 'question',
  End: 'end',
} as const
export type FlowNodeTypeValue = ValueOf<typeof FlowNodeType>

export const FLOW_NODE_LABELS = {
  [FlowNodeType.Trigger]: 'Disparador',
  [FlowNodeType.Condition]: 'Condición',
  [FlowNodeType.Action]: 'Acción',
  // `wait` se conserva únicamente para leer flujos antiguos. En el editor,
  // ambos formatos se presentan como un único bloque Pausa (`wait_any`).
  [FlowNodeType.Wait]: 'Pausa',
  [FlowNodeType.WaitAny]: 'Pausa',
  [FlowNodeType.Question]: 'Pregunta (botones)',
  [FlowNodeType.End]: 'Fin',
} satisfies Record<FlowNodeTypeValue, string>

export const WaitAnyConditionKind = {
  Timer: 'timer',
  Message: 'message',
  BusinessHours: 'business_hours',
  MediaPlayed: 'media_played',
} as const
export type WaitAnyConditionKindValue = ValueOf<typeof WaitAnyConditionKind>

export const WAIT_ANY_CONDITION_LABELS = {
  [WaitAnyConditionKind.Timer]: 'Temporizador',
  [WaitAnyConditionKind.Message]: 'Hasta recibir mensaje',
  [WaitAnyConditionKind.BusinessHours]: 'Excepto horas laborales',
  [WaitAnyConditionKind.MediaPlayed]: 'Hasta que se reproduce lo enviado',
} satisfies Record<WaitAnyConditionKindValue, string>

/** Handles fijos del nodo Pregunta que no dependen de los botones
 *  configurados (a diferencia de btn_1..btn_n, que sí). */
export const QuestionHandle = {
  Other: 'other',
  Timeout: 'timeout',
} as const
export type QuestionHandleValue = ValueOf<typeof QuestionHandle>

export const QUESTION_HANDLE_LABELS = {
  [QuestionHandle.Other]: 'Otra respuesta',
  [QuestionHandle.Timeout]: 'Sin respuesta',
} satisfies Record<QuestionHandleValue, string>

export const FlowConditionType = {
  StageEquals: 'stage_equals',
  OriginContains: 'origin_contains',
  ServiceContains: 'service_contains',
  SellerEquals: 'seller_equals',
  TagPresent: 'tag_present',
  WhatsAppWindowOpen: 'whatsapp_window_open',
  BusinessHours: 'business_hours',
} as const
export type FlowConditionTypeValue = ValueOf<typeof FlowConditionType>

export const FLOW_CONDITION_LABELS = {
  [FlowConditionType.StageEquals]: 'Etapa es',
  [FlowConditionType.OriginContains]: 'Origen contiene',
  [FlowConditionType.ServiceContains]: 'Servicio contiene',
  [FlowConditionType.SellerEquals]: 'Vendedor es',
  [FlowConditionType.TagPresent]: 'Tiene etiqueta',
  [FlowConditionType.WhatsAppWindowOpen]: 'Ventana WhatsApp abierta',
  [FlowConditionType.BusinessHours]: 'Está en horario laboral',
} satisfies Record<FlowConditionTypeValue, string>

export const FlowHandle = {
  Next: 'next',
  Yes: 'yes',
  No: 'no',
} as const
export type FlowHandleValue = ValueOf<typeof FlowHandle>

export const AutomationBuilderMode = {
  Simple: 'simple',
  Visual: 'visual',
} as const
export type AutomationBuilderModeValue = ValueOf<typeof AutomationBuilderMode>

export const AutomationExecutionStatus = {
  Scheduled: 'scheduled',
  Running: 'running',
  Completed: 'completed',
  Failed: 'failed',
  Skipped: 'skipped',
} as const
export type AutomationExecutionStatusValue = ValueOf<typeof AutomationExecutionStatus>

export const NotificationType = {
  InternalNoteMention: 'internal_note_mention',
  Automation: 'automation',
} as const
export type NotificationTypeValue = ValueOf<typeof NotificationType>

export const AutomationRecipient = {
  Seller: 'seller',
  Specific: 'specific',
} as const
export type AutomationRecipientValue = ValueOf<typeof AutomationRecipient>

export const TaskTypeValue = {
  WhatsApp: 'whatsapp',
  Call: 'llamada',
  Quote: 'cotizacion',
  Appointment: 'cita',
  FollowUp: 'seguimiento',
  Other: 'otro',
} as const
export type TaskTypeCatalogValue = ValueOf<typeof TaskTypeValue>

export const TASK_TYPE_OPTIONS = [
  { value: TaskTypeValue.WhatsApp, label: 'WhatsApp' },
  { value: TaskTypeValue.Call, label: 'Llamada' },
  { value: TaskTypeValue.Quote, label: 'Cotización' },
  { value: TaskTypeValue.Appointment, label: 'Cita' },
  { value: TaskTypeValue.FollowUp, label: 'Seguimiento' },
  { value: TaskTypeValue.Other, label: 'Otro' },
] as const satisfies ReadonlyArray<{ value: TaskTypeCatalogValue; label: string }>

export const TaskPriorityValue = {
  Low: 'low',
  Normal: 'normal',
  High: 'high',
} as const
export type TaskPriorityCatalogValue = ValueOf<typeof TaskPriorityValue>

export const TaskStatusValue = {
  Pending: 'pending',
  Completed: 'completed',
  Canceled: 'canceled',
} as const
export type TaskStatusCatalogValue = ValueOf<typeof TaskStatusValue>

export const TASK_PRIORITY_OPTIONS = [
  { value: TaskPriorityValue.Low, label: 'Baja' },
  { value: TaskPriorityValue.Normal, label: 'Normal' },
  { value: TaskPriorityValue.High, label: 'Alta' },
] as const satisfies ReadonlyArray<{ value: TaskPriorityCatalogValue; label: string }>

export const TASK_PRIORITY_LABELS = {
  [TaskPriorityValue.Low]: 'Baja',
  [TaskPriorityValue.Normal]: 'Normal',
  [TaskPriorityValue.High]: 'Alta',
} satisfies Record<TaskPriorityCatalogValue, string>

/** "2h 5min", "30s", "1h" — nunca vacío, para el título del nodo Esperar. */
export function formatWaitDuration(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  const parts: string[] = []
  if (hours) parts.push(`${hours}h`)
  if (minutes) parts.push(`${minutes}min`)
  if (seconds || parts.length === 0) parts.push(`${seconds}s`)
  return parts.join(' ')
}

export function isAutomationTrigger(value: string): value is AutomationTriggerValue {
  return Object.values(AutomationTrigger).some(item => item === value)
}

export function isAutomationActionType(value: string): value is AutomationActionTypeValue {
  return Object.values(AutomationActionType).some(item => item === value)
}

export function isFlowConditionType(value: string): value is FlowConditionTypeValue {
  return Object.values(FlowConditionType).some(item => item === value)
}

export function isTaskType(value: string): value is TaskTypeCatalogValue {
  return Object.values(TaskTypeValue).some(item => item === value)
}

export function isTaskPriority(value: string): value is TaskPriorityCatalogValue {
  return Object.values(TaskPriorityValue).some(item => item === value)
}

export function assertNever(value: never): never {
  throw new Error(`Valor de dominio no contemplado: ${JSON.stringify(value)}`)
}
