/**
 * Copia texto al portapapeles. Primero la API moderna y, si el navegador la
 * niega, el `execCommand('copy')` de siempre: el navegador integrado de la app
 * de escritorio de Claude rechaza `clipboard.writeText` ("Document is not
 * focused", permiso denegado) y el botón de copiar enlace fallaba siempre ahí.
 * Hay que llamarla dentro del clic: los dos caminos piden un gesto del usuario.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return copyWithSelection(text)
  }
}

function copyWithSelection(text: string): boolean {
  const field = document.createElement('textarea')
  field.value = text
  field.setAttribute('readonly', '')
  // Fuera de la vista pero en el documento: si no está, no se puede seleccionar.
  field.style.position = 'fixed'
  field.style.top = '-1000px'
  field.style.opacity = '0'
  const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
  document.body.appendChild(field)
  field.select()
  let copied = false
  try {
    copied = document.execCommand('copy')
  } catch {
    copied = false
  } finally {
    field.remove()
    previousFocus?.focus()
  }
  return copied
}
