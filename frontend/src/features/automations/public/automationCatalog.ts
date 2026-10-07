/** Explicit consumer contract; implementation remains with its feature owner. */
export { ACTIVE_EXECUTION_STATUSES, AUTOMATION_TRIGGERS, AutomationExecutionStatus, NotificationType, SERVICE_WINDOW_ERROR_CODE, automationStepLabel } from '../domain/automationCatalog'
export { TASK_PRIORITY_LABELS, TASK_PRIORITY_OPTIONS, TASK_TYPE_OPTIONS, TaskPriorityValue, TaskStatusValue, TaskTypeValue, isTaskPriority, isTaskType } from '../../tasks/public/taskCatalog'
export type { NotificationTypeValue } from '../domain/automationCatalog'
export type { TaskPriorityCatalogValue, TaskStatusCatalogValue, TaskTypeCatalogValue } from '../../tasks/public/taskCatalog'
