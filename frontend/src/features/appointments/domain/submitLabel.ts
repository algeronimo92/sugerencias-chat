/** Texto del botón de guardar. La asesora confirma el monto en el mismo botón
 *  que pulsa ("Separar cita · S/ 50.00"), sin un paso de confirmación aparte;
 *  sin adelanto lo dice ("Separar sin adelanto") para que no pase inadvertido. */
export function submitLabel(deposit: unknown, currency: string | null, hasDepositField: boolean): string {
  if (!hasDepositField) return 'Separar cita'
  const amount = Number(deposit)
  if (deposit === null || deposit === undefined || deposit === '' || !Number.isFinite(amount) || amount <= 0) return 'Separar sin adelanto'
  return `Separar cita · ${formatAmount(amount, currency)}`
}

function formatAmount(amount: number, currency: string | null): string {
  if (currency) {
    try {
      return amount.toLocaleString('es-PE', { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 })
    } catch {
      // Código que el navegador no conoce: el número con el código al lado.
      return `${amount.toFixed(2)} ${currency}`
    }
  }
  return amount.toFixed(2)
}
