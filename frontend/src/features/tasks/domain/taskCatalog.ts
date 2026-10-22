import type { ValueOf } from '../../../shared/types'


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

export function isTaskType(value: string): value is TaskTypeCatalogValue {
  return Object.values(TaskTypeValue).some(item => item === value)
}

export function isTaskPriority(value: string): value is TaskPriorityCatalogValue {
  return Object.values(TaskPriorityValue).some(item => item === value)
}
