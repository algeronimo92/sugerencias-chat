import type { Message } from "../types";

/** Ventana entre fotos/videos consecutivos del mismo remitente para
 * agruparlos como un álbum cuando NO hay `album_id` explícito (ver abajo) —
 * o sea, todo lo que manda el cliente.
 *
 * En WhatsApp el álbum es explícito a nivel de protocolo: el cliente emisor
 * manda un sobre que declara cuántas piezas vienen y cada media apunta a él.
 * Ese sobre viaja cifrado dentro del mensaje y la Cloud API de Meta no lo
 * expone — su webhook entrega cada foto como un mensaje suelto, sin ningún
 * campo de álbum, lote ni grupo. Por eso para lo entrante no hay nada que
 * reconstruir y esto es necesariamente un heurístico.
 *
 * 5 segundos y no más: `sent_at` de un mensaje entrante sale del `timestamp`
 * que pone el propio WhatsApp al enviar (ver el nodo "normalizar eventos
 * Meta"), no de cuándo llegó el webhook, así que las piezas de un álbum real
 * comparten el segundo o difieren en uno o dos. Una ventana más ancha no
 * captura ningún álbum extra: solo fusiona envíos distintos. */
const ALBUM_WINDOW_MS = 5_000;

const GROUPABLE_TYPES = new Set(["image", "video", "ptv"]);

function qualifies(message: Message): boolean {
  return (
    !!message.message_type &&
    GROUPABLE_TYPES.has(message.message_type) &&
    !message.deleted_at &&
    !!message.sent_at
  );
}

/** Un epígrafe es contenido escrito a mano sobre esa pieza puntual: marca un
 * envío deliberado e individual, no una tanda. Solo desagrupa en el camino
 * heurístico — un álbum con `album_id` explícito se respeta con epígrafe y
 * todo, porque ahí la agrupación es un hecho y no una suposición (de hecho el
 * ChatComposer manda el epígrafe en el último ítem del lote).
 *
 * Además evita perder texto: AlbumBubble solo pinta el primer epígrafe no
 * vacío del grupo, así que dos piezas con epígrafe en la misma grilla harían
 * desaparecer una de las dos. */
function hasCaption(message: Message): boolean {
  return !!(message.content ?? "").trim();
}

/** Id de álbum explícito: lo pone el propio CRM al mandar varias fotos/videos
 * juntos desde el mismo picker (ver ChatComposer). Es el equivalente interno
 * del sobre de álbum de WhatsApp — intención del emisor capturada al
 * seleccionar— con la diferencia de que no puede salir al cable: la Cloud API
 * de Meta no tiene forma de mandar un álbum nativo, así que el cliente ve las
 * piezas sueltas y esto agrupa solo dentro del hilo del CRM. Cuando está
 * presente reemplaza al heurístico de tiempo: es exacto, no una adivinanza. */
function albumIdOf(message: Message): string | null {
  const value = message.payload?.album_id;
  return typeof value === "string" && value ? value : null;
}

function continuesRun(message: Message, prev: Message): boolean {
  if (!qualifies(message)) return false;
  const prevAlbumId = albumIdOf(prev);
  const messageAlbumId = albumIdOf(message);
  if (prevAlbumId || messageAlbumId)
    return prevAlbumId !== null && prevAlbumId === messageAlbumId;
  // Se mira también el epígrafe del anterior: si no, una pieza con epígrafe
  // quedaría excluida del grupo que abre pero arrastraría a la siguiente.
  if (hasCaption(message) || hasCaption(prev)) return false;
  return (
    message.sender === prev.sender &&
    new Date(message.sent_at as string).getTime() -
      new Date(prev.sent_at as string).getTime() <=
      ALBUM_WINDOW_MS
  );
}

/**
 * Corridas de 2+ fotos/videos consecutivos que forman un álbum: por
 * `album_id` explícito cuando lo hay (lo que mandó este mismo CRM), o si no
 * por el heurístico de tiempo/remitente (lo que llega del cliente). Se pintan
 * como una sola grilla en vez de burbujas separadas.
 *
 * Devuelve un mapa del id del PRIMER mensaje de cada grupo a la lista
 * completa (en orden) de mensajes del grupo. Un mensaje que califica pero
 * queda solo (sin vecino que lo agrupe) no entra en el mapa y sigue su
 * burbuja individual de siempre.
 */
export function groupAlbumMessages(
  messages: Message[],
): Map<number, Message[]> {
  const groups = new Map<number, Message[]>();
  let run: Message[] = [];

  function flush() {
    if (run.length >= 2) groups.set(run[0].id, run);
  }

  for (const message of messages) {
    const prev = run[run.length - 1];
    if (prev != null && continuesRun(message, prev)) {
      run.push(message);
      continue;
    }
    flush();
    run = qualifies(message) ? [message] : [];
  }
  flush();

  return groups;
}

/** Ids de todos los mensajes que son miembros de algún grupo (incluido el
 * primero) — para saltear su burbuja individual en el hilo: ya la pinta la
 * grilla del grupo. */
export function albumMemberIds(groups: Map<number, Message[]>): Set<number> {
  const ids = new Set<number>();
  for (const group of groups.values()) {
    for (const message of group) ids.add(message.id);
  }
  return ids;
}
