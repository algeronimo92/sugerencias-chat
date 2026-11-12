/**
 * Claves de caché de React Query de esta feature. Son el contrato con el que
 * otras features y el tiempo real refrescan sus datos: nadie escribe una clave
 * a mano fuera de un `keys.ts` (lo verifica src/test/architecture.test.ts).
 * Cada `all` es el prefijo de su familia: invalidarlo alcanza a todas sus
 * variantes.
 */

export const appointmentKeys = {
  all: ['appointments'] as const,
  // Fuera de `all`: refrescar el historial de citas no tiene por qué releer
  // la plantilla del evento.
  calendarTemplate: ['appointment-calendar-template'] as const,
  // Los avisos de cita tampoco cambian cuando se agenda una cita.
  notices: ['appointment-notice'] as const,
  notice: (audience: 'client' | 'staff') => ['appointment-notice', audience] as const,
  // Moneda del negocio para el símbolo del adelanto: cambia casi nunca.
  businessCurrency: ['appointment-business-currency'] as const,
}
