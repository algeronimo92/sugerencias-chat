export type AppointmentStatus = 'created' | 'duplicate' | 'created_with_errors' | 'error'

export const APPOINTMENT_STATUS_LABELS: Record<AppointmentStatus, string> = {
  created: 'Creada',
  duplicate: 'Duplicada',
  created_with_errors: 'Creada con errores',
  error: 'Error',
}

export const APPOINTMENT_STATUS_COLORS: Record<AppointmentStatus, string> = {
  created: 'bg-green-100 text-green-800 dark:bg-green-950/50 dark:text-green-300',
  duplicate: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  created_with_errors: 'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300',
  error: 'bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-300',
}
