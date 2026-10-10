const requestTails = new Map<string, Promise<void>>()

/** Los envíos se serializan por chat, pero todas las burbujas aparecen de
 * inmediato. Así se conserva el orden de pulsación incluso si una carga de
 * archivo tarda más que el texto que se escribió después. */
export function enqueueForChat<T>(chatId: string, request: () => Promise<T>): Promise<T> {
  const previous = requestTails.get(chatId) ?? Promise.resolve()
  const current = previous.then(request)
  const tail = current.then(() => undefined, () => undefined)
  requestTails.set(chatId, tail)
  void tail.finally(() => {
    if (requestTails.get(chatId) === tail) requestTails.delete(chatId)
  })
  return current
}
