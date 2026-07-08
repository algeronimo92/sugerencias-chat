export interface StaticMapTile {
  url: string
  markerXPercent: number
  markerYPercent: number
}

/**
 * Resuelve el tile de OpenStreetMap que contiene el punto dado, más la
 * posición del marcador dentro de ese tile en porcentaje (para poder
 * posicionarlo con CSS sin importar a qué tamaño se termine renderizando
 * la imagen). Solo pedimos un tile — no un mapa stitcheado — para no
 * depender de ningún servicio de "static maps" de terceros, solo del
 * tile server estándar de OSM.
 */
export function getStaticMapTile(lat: number, lon: number, zoom: number): StaticMapTile {
  const n = 2 ** zoom
  const xFloat = ((lon + 180) / 360) * n
  const latRad = (lat * Math.PI) / 180
  const yFloat = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n
  const xTile = Math.floor(xFloat)
  const yTile = Math.floor(yFloat)

  return {
    url: `https://tile.openstreetmap.org/${zoom}/${xTile}/${yTile}.png`,
    markerXPercent: (xFloat - xTile) * 100,
    markerYPercent: (yFloat - yTile) * 100,
  }
}
