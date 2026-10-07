/**
 * El bus de tiempo real de la app: un módulo por feature. Como los
 * suscriptores del backend, cada feature decide qué hace ante cada evento; acá
 * solo se los reúne.
 */

import { createRealtimeBus, type RealtimeBus } from '../realtime/bus'
import { createAiRealtime } from '../features/ai/public/realtime'
import { createAutomationsRealtime } from '../features/automations/public/realtime'
import { createChatsRealtime } from '../features/chats/public/realtime'
import { createDashboardRealtime } from '../features/dashboard/public/realtime'
import { createIssueReportsRealtime } from '../features/issue-reports/public/realtime'
import { createLeadsRealtime } from '../features/leads/public/realtime'
import { createMediaRealtime } from '../features/media/public/realtime'
import { createNotificationsRealtime } from '../features/notifications/public/realtime'
import { createTasksRealtime } from '../features/tasks/public/realtime'
import { createTemplatesRealtime } from '../features/templates/public/realtime'

export function createAppRealtimeBus(): RealtimeBus {
  return createRealtimeBus([
    createChatsRealtime(),
    createLeadsRealtime(),
    createTasksRealtime(),
    createDashboardRealtime(),
    createTemplatesRealtime(),
    createAiRealtime(),
    createAutomationsRealtime(),
    createMediaRealtime(),
    createNotificationsRealtime(),
    createIssueReportsRealtime(),
  ])
}
