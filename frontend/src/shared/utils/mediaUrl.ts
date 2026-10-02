export function resolveMediaUrl(mediaUrl: string | null): string | null {
  if (!mediaUrl) return null;
  // Los mensajes optimistas usan data:/blob: locales hasta que el backend
  // devuelve la URL durable. Las URLs absolutas también deben pasar intactas.
  if (/^(?:data:|blob:|https?:\/\/)/i.test(mediaUrl)) return mediaUrl;
  const base = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";
  return `${base}${mediaUrl}`;
}
