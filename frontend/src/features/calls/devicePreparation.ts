/**
 * Preparar el dispositivo antes de la primera llamada. Sin esto, la primera
 * llamada real se pierde detrás del cuadro de permiso del micrófono, y el
 * timbre no suena porque el navegador bloquea el audio hasta que la persona
 * interactúa con la página.
 */

const KEY = 'calls.devicePrepared'

export function isDevicePrepared(): boolean {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    // Sin almacenamiento (modo privado) no se insiste en cada carga.
    return true
  }
}

export type PreparationResult = 'ready' | 'microphone_blocked'

/** Pide el micrófono y las notificaciones. El clic que lo dispara ya
 *  habilita el sonido del timbre. */
export async function prepareDevice(): Promise<PreparationResult> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    stream.getTracks().forEach(track => track.stop())
  } catch {
    return 'microphone_blocked'
  }
  try {
    if ('Notification' in window && Notification.permission === 'default') await Notification.requestPermission()
  } catch {
    // Las notificaciones son un extra: sin ellas la llamada igual suena con el CRM abierto.
  }
  try {
    localStorage.setItem(KEY, '1')
  } catch {
    // Ver isDevicePrepared.
  }
  return 'ready'
}
