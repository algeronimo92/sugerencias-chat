import { useEffect, useRef, useState } from 'react'

// Duración del resaltado al saltar a un mensaje desde la búsqueda.
const MESSAGE_FLASH_MS = 2000
// Ventana durante la cual las imágenes que van cargando re-anclan el scroll
// al mensaje saltado — o, en una apertura normal, re-pegan la vista al fondo
// (no guardamos dimensiones de toda la media, así que no se puede reservar el
// espacio exacto por adelantado).
const MEDIA_SETTLE_MS = 4000
// Distancia al fondo a partir de la cual se ofrece el botón "ir al último
// mensaje" (mayor que el umbral de auto-scroll para que no parpadee cerca
// del borde).
const SCROLL_TO_BOTTOM_THRESHOLD_PX = 300

interface Params {
  chatId: string
  /** Mensaje al que saltar al abrir, desde un resultado de búsqueda. */
  highlightMessageId: number | null
  isLoading: boolean
  /** Clave del último ítem del hilo: cambia cuando llega algo nuevo al final. */
  lastTimelineKey: string | null
  timelineLength: number
  pageCount: number
  historyPageCount: number
  hasNextPage: boolean
  isFetchingNextPage: boolean
  fetchNextPage: () => Promise<{ isError: boolean }>
  historyError: Error | null
}

/**
 * Toda la maquinaria de scroll del hilo de chat.
 *
 * Resuelve cuatro cosas que se pisan entre sí:
 *
 * - **Apertura**: cada chat arranca en su mensaje más reciente.
 * - **Paginar hacia atrás**: al cargar mensajes viejos la vista se queda donde
 *   estaba, compensando el alto que se agregó arriba.
 * - **Salto a un mensaje**: desde la búsqueda o desde una cita, incluso si
 *   todavía no está cargado (se pagina hacia atrás hasta encontrarlo).
 * - **Media que asienta**: imágenes y videos no reservan altura antes de
 *   cargar, así que cada carga empuja el layout y hay que volver a anclar.
 *
 * El estado vive en refs y no en useState a propósito: son valores que los
 * handlers de scroll leen y escriben muchas veces por segundo, y pasarlos por
 * el ciclo de render provocaría un re-render por tick.
 */
export function useThreadScroll({
  chatId,
  highlightMessageId,
  isLoading,
  lastTimelineKey,
  timelineLength,
  pageCount,
  historyPageCount,
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
  historyError,
}: Params) {
  const threadRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const initialScrollDoneRef = useRef(false)
  const isNearBottomRef = useRef(true)
  const loadingOlderRef = useRef(false)
  const latestTimelineKeyRef = useRef<string | null>(null)
  const prependSnapshotRef = useRef<{ scrollHeight: number; scrollTop: number } | null>(null)
  // Salto al mensaje matcheado por la búsqueda: pendiente hasta que el
  // mensaje esté cargado; el flash se apaga solo y la clase con transición
  // hace que el resaltado se desvanezca.
  const pendingJumpRef = useRef<number | null>(null)
  const jumpAttemptsRef = useRef(0)
  // Ancla activa tras el salto: cada media que carga vuelve a centrar el
  // mensaje hasta que expira o el usuario scrollea a mano.
  const anchorRef = useRef<{ messageId: number; until: number } | null>(null)
  // Fondo "pegajoso" tras abrir el chat: mientras la ventana esté viva, cada
  // crecimiento del contenido (media sin caja reservada, fuentes, re-medición
  // del ancho) vuelve a pegar la vista al último mensaje. Igual que el ancla
  // del salto: expira sola o la suelta el scroll manual.
  const stickToBottomUntilRef = useRef(0)
  const contentRef = useRef<HTMLDivElement>(null)
  const [showScrollToBottom, setShowScrollToBottom] = useState(false)
  const [hasNewWhileAway, setHasNewWhileAway] = useState(false)
  const [flashMessageId, setFlashMessageId] = useState<number | null>(null)
  // Cada salto a un mensaje citado incrementa esto para reactivar el efecto
  // que pagina hacia atrás hasta encontrarlo.
  const [jumpNonce, setJumpNonce] = useState(0)

  // Cada chat empieza mostrando sus mensajes más recientes.
  useEffect(() => {
    initialScrollDoneRef.current = false
    isNearBottomRef.current = true
    loadingOlderRef.current = false
    latestTimelineKeyRef.current = null
    prependSnapshotRef.current = null
    stickToBottomUntilRef.current = 0
    setShowScrollToBottom(false)
    setHasNewWhileAway(false)
  }, [chatId])

  useEffect(() => {
    pendingJumpRef.current = highlightMessageId
    jumpAttemptsRef.current = 0
    anchorRef.current = null
    setFlashMessageId(null)
  }, [chatId, highlightMessageId])

  function jumpToMessage(container: HTMLElement, messageId: number): boolean {
    const el = container.querySelector(`[data-message-id="${messageId}"]`)
    if (!el) return false
    pendingJumpRef.current = null
    isNearBottomRef.current = false
    anchorRef.current = { messageId, until: Date.now() + MEDIA_SETTLE_MS }
    requestAnimationFrame(() => {
      el.scrollIntoView({ block: 'center' })
      setFlashMessageId(messageId)
      window.setTimeout(() => setFlashMessageId(null), MESSAGE_FLASH_MS)
    })
    return true
  }

  // Las imágenes/videos no reservan altura antes de cargar, así que cada
  // carga empuja el layout. Este handler (capture: load no burbujea) vuelve
  // a centrar el mensaje saltado mientras el ancla siga viva, o mantiene la
  // vista pegada al fondo en una apertura normal.
  function handleMediaSettled() {
    const container = threadRef.current
    if (!container || !initialScrollDoneRef.current) return
    const anchor = anchorRef.current
    if (anchor && Date.now() < anchor.until) {
      container
        .querySelector(`[data-message-id="${anchor.messageId}"]`)
        ?.scrollIntoView({ block: 'center' })
      return
    }
    if (isNearBottomRef.current) {
      container.scrollTop = container.scrollHeight
    }
  }

  // El scroll manual del usuario suelta el ancla y el fondo pegajoso
  // (wheel/touch no se disparan con scrollIntoView, así que no interfiere
  // con el re-anclado).
  function releaseAnchor() {
    anchorRef.current = null
    stickToBottomUntilRef.current = 0
  }

  // Ancho del hilo, para calcular el tamaño exacto al que va a renderizar
  // cada imagen/video y reservar esa caja antes de que cargue.
  const [threadWidth, setThreadWidth] = useState(0)
  useEffect(() => {
    const el = threadRef.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      setThreadWidth(entries[0].contentRect.width)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // Los eventos load no cubren todos los reflows (la re-medición del ancho
  // del hilo re-escala las cajas de media sin disparar load, y fuentes/audio
  // players también empujan el layout). Observar el alto real del contenido
  // cubre cualquier causa: mientras haya un ancla viva se re-centra el
  // mensaje saltado; mientras el fondo pegajoso siga activo (o el usuario ya
  // esté leyendo el final) se re-pega al último mensaje.
  useEffect(() => {
    const content = contentRef.current
    if (!content) return
    const observer = new ResizeObserver(() => {
      const container = threadRef.current
      if (!container) return
      const anchor = anchorRef.current
      if (anchor && Date.now() < anchor.until) {
        container
          .querySelector(`[data-message-id="${anchor.messageId}"]`)
          ?.scrollIntoView({ block: 'center' })
        return
      }
      if (pendingJumpRef.current) return
      if (
        Date.now() < stickToBottomUntilRef.current ||
        (initialScrollDoneRef.current && isNearBottomRef.current)
      ) {
        container.scrollTop = container.scrollHeight
      }
    })
    observer.observe(content)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const container = threadRef.current
    if (!container || isLoading) return

    if (!initialScrollDoneRef.current) {
      initialScrollDoneRef.current = true
      latestTimelineKeyRef.current = lastTimelineKey
      if (pendingJumpRef.current) {
        if (jumpToMessage(container, pendingJumpRef.current)) return
      } else {
        // La ventana arranca acá y no dentro del rAF: cualquier reflow entre
        // este efecto y el primer frame ya tiene que re-pegar al fondo.
        stickToBottomUntilRef.current = Date.now() + MEDIA_SETTLE_MS
      }
      requestAnimationFrame(() => {
        container.scrollTop = container.scrollHeight
        isNearBottomRef.current = true
      })
      return
    }

    const snapshot = prependSnapshotRef.current
    if (snapshot) {
      prependSnapshotRef.current = null
      requestAnimationFrame(() => {
        // Compensa exactamente la altura agregada arriba; el mensaje que el
        // usuario estaba leyendo queda en el mismo lugar de la pantalla.
        container.scrollTop = snapshot.scrollTop + (container.scrollHeight - snapshot.scrollHeight)
      })
      return
    }

    if (lastTimelineKey !== latestTimelineKeyRef.current) {
      latestTimelineKeyRef.current = lastTimelineKey
      if (isNearBottomRef.current) {
        requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ block: 'end' }))
      } else {
        // Está leyendo historial: no se lo mueve, pero el botón de bajar
        // avisa que llegó algo nuevo.
        setHasNewWhileAway(true)
      }
    }
    // historyPageCount entra acá para que una página de historial vacía —el
    // tramo que todavía se solapa con lo registrado— también consuma el
    // snapshot, en vez de dejarlo colgado para el próximo render.
  }, [chatId, isLoading, lastTimelineKey, timelineLength, pageCount, historyPageCount])

  // Un pedido de historial fallido no agrega nada arriba: el snapshot que se
  // tomó antes de pedirlo tiene que descartarse o la vista salta después.
  useEffect(() => {
    if (historyError) prependSnapshotRef.current = null
  }, [historyError])

  // Si el chat ya estaba cacheado sin el mensaje buscado (la primera página
  // agrandada solo aplica con cache vacía), se pagina hacia atrás hasta
  // encontrarlo, con tope para no recorrer historiales enormes.
  useEffect(() => {
    const container = threadRef.current
    const target = pendingJumpRef.current
    if (!container || !target || isLoading || !initialScrollDoneRef.current) return
    if (jumpToMessage(container, target)) return
    if (hasNextPage && !isFetchingNextPage && jumpAttemptsRef.current < 20) {
      jumpAttemptsRef.current += 1
      void fetchNextPage()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, pageCount, hasNextPage, isFetchingNextPage, highlightMessageId, jumpNonce])

  /** Ir al mensaje citado al tocar el recuadro de la respuesta. Si todavía no
   * está cargado, se delega en el efecto de arriba, que pagina hacia atrás
   * hasta encontrarlo igual que al abrir desde un resultado de búsqueda. */
  function goToQuotedMessage(messageId: number) {
    const container = threadRef.current
    if (container && jumpToMessage(container, messageId)) return
    pendingJumpRef.current = messageId
    jumpAttemptsRef.current = 0
    setJumpNonce((nonce) => nonce + 1)
  }

  /** Carga contenido más viejo dejando la vista donde está: se guarda el alto
   * antes de pedirlo y el efecto de restauración compensa lo que se agregó
   * arriba. Si el pedido falla se descarta el snapshot para no mover nada. */
  function loadOlder(request: () => Promise<{ isError: boolean }>) {
    const container = threadRef.current
    if (!container || loadingOlderRef.current) return
    loadingOlderRef.current = true
    // Al paginar hacia atrás manda la restauración del snapshot, nunca el
    // fondo pegajoso de la apertura.
    stickToBottomUntilRef.current = 0
    prependSnapshotRef.current = {
      scrollHeight: container.scrollHeight,
      scrollTop: container.scrollTop,
    }
    void request()
      .then((result) => {
        if (result.isError) prependSnapshotRef.current = null
      })
      .finally(() => {
        loadingOlderRef.current = false
      })
  }

  function handleThreadScroll() {
    const container = threadRef.current
    if (!container) return

    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight
    isNearBottomRef.current = distanceFromBottom < 120
    if (isNearBottomRef.current) setHasNewWhileAway(false)
    // React ignora el set cuando el valor no cambia: esto no re-renderiza en
    // cada tick de scroll.
    setShowScrollToBottom(distanceFromBottom > SCROLL_TO_BOTTOM_THRESHOLD_PX)

    if (
      container.scrollTop > 80 ||
      !hasNextPage ||
      isFetchingNextPage ||
      loadingOlderRef.current
    ) {
      return
    }

    loadOlder(fetchNextPage)
  }

  function scrollToBottom() {
    releaseAnchor()
    isNearBottomRef.current = true
    setHasNewWhileAway(false)
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }

  return {
    threadRef,
    bottomRef,
    contentRef,
    threadWidth,
    flashMessageId,
    showScrollToBottom,
    hasNewWhileAway,
    handleMediaSettled,
    releaseAnchor,
    handleThreadScroll,
    scrollToBottom,
    goToQuotedMessage,
    loadOlder,
  }
}
