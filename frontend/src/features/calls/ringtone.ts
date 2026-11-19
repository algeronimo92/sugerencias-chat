/** Timbre generado en el navegador: sin archivo de audio que cargar ni que
 *  pueda faltar sin conexión. Devuelve cómo apagarlo. El navegador solo deja
 *  sonar si la persona ya interactuó con la página; si no, falla en silencio. */
export function startRingtone(): () => void {
  const AudioContextClass = window.AudioContext
  if (!AudioContextClass) return () => {}
  let context: AudioContext
  try {
    context = new AudioContextClass()
  } catch {
    return () => {}
  }
  let stopped = false
  const ring = () => {
    if (stopped) return
    const now = context.currentTime
    for (const offset of [0, 0.5]) {
      const oscillator = context.createOscillator()
      const gain = context.createGain()
      oscillator.frequency.value = 480
      gain.gain.setValueAtTime(0.0001, now + offset)
      gain.gain.exponentialRampToValueAtTime(0.15, now + offset + 0.03)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.4)
      oscillator.connect(gain).connect(context.destination)
      oscillator.start(now + offset)
      oscillator.stop(now + offset + 0.42)
    }
  }
  ring()
  const interval = setInterval(ring, 2_500)
  return () => {
    stopped = true
    clearInterval(interval)
    void context.close().catch(() => {})
  }
}
