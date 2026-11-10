import { apiUrl } from "../config";

export function resolveMediaUrl(mediaUrl: string | null): string | null {
  if (!mediaUrl) return null;
  // Los mensajes optimistas usan data:/blob: locales hasta que el backend
  // devuelve la URL durable. Las URLs absolutas también deben pasar intactas.
  if (/^(?:data:|blob:|https?:\/\/)/i.test(mediaUrl)) return mediaUrl;
  return apiUrl(mediaUrl);
}

/** URL de la miniatura (WebP de hasta 320 px) de una imagen de la biblioteca.
 * Solo existe para los archivos que sirve el backend (`/media/<archivo>`):
 * para data:/blob:/URLs externas devuelve null y hay que mostrar el original.
 * Si el backend no tiene miniatura (no es imagen, archivo roto) responde 404
 * y quien la pinta vuelve al original. */
export function thumbnailUrl(mediaUrl: string | null): string | null {
  if (!mediaUrl) return null;
  const match = /^\/media\/([^/?#]+)\/?(?:[?#].*)?$/.exec(mediaUrl);
  if (!match) return null;
  return apiUrl(`/media/${match[1]}/thumbnail`);
}
