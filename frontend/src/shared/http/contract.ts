/**
 * Tipos del contrato HTTP, derivados de `src/api/schema.d.ts` (lo genera
 * `scripts/generate-api-types.sh` desde el OpenAPI del backend).
 *
 * Cada función de un `api.ts` declara la respuesta de su request con
 * `ApiResponse<ruta, método>` y su propio tipo de retorno con el tipo que usa
 * la feature. TypeScript verifica entonces que lo que manda el backend encaja
 * con lo que la pantalla espera: si el backend cambia un campo, regenerar el
 * esquema hace fallar la compilación en esa función, no en producción.
 */

import type { components, paths } from '../../api/schema'
import type { JsonObject, JsonValue } from '../types'

export type ApiSchemas = components['schemas']

export type ApiPath = keyof paths
export type ApiMethod = 'get' | 'post' | 'put' | 'patch' | 'delete'

type JsonContent<Response> = Response extends { content: { 'application/json': infer Body } } ? Body : void

type SuccessContent<Responses> =
  200 extends keyof Responses ? JsonContent<Responses[200]>
    : 201 extends keyof Responses ? JsonContent<Responses[201]>
      : 202 extends keyof Responses ? JsonContent<Responses[202]>
        : 204 extends keyof Responses ? void
          : never

type Operation<P extends ApiPath, M extends ApiMethod> = M extends keyof paths[P] ? NonNullable<paths[P][M]> : never

/**
 * Lo que efectivamente llega en una respuesta.
 *
 * - Todos los campos del modelo. Pydantic marca como opcionales en el JSON
 *   Schema de salida los campos con valor por defecto, pero al serializar los
 *   manda siempre (el backend no usa `response_model_exclude_none` ni
 *   `exclude_unset`). Un campo opcional del esquema llega, como mucho, en
 *   `null`.
 * - Donde el esquema dice `unknown` (un `dict` o `Any` del backend), llega un
 *   valor JSON: la respuesta ya pasó por `JSON.parse`, no puede traer otra cosa.
 */
export type Delivered<T> =
  unknown extends T ? JsonValue
    : T extends readonly (infer Item)[] ? Delivered<Item>[]
      : T extends object ? { [K in keyof T]-?: Delivered<Exclude<T[K], undefined>> }
        : T

/** Cuerpo de la respuesta exitosa de `método ruta`. */
export type ApiResponse<P extends ApiPath, M extends ApiMethod> =
  Operation<P, M> extends { responses: infer Responses } ? Delivered<SuccessContent<Responses>> : never

/** Cuerpo JSON que acepta `método ruta`. */
export type ApiBody<P extends ApiPath, M extends ApiMethod> =
  Operation<P, M> extends { requestBody?: infer Body } ? JsonContent<NonNullable<Body>> : never

/** Parámetros de query que acepta `método ruta`. */
export type ApiQuery<P extends ApiPath, M extends ApiMethod> =
  Operation<P, M> extends { parameters: { query?: infer Query } } ? NonNullable<Query> : never

// --- Donde el contrato no alcanza ------------------------------------------
//
// Cada uso de UntypedResponse queda listado en architecture.test.ts y la
// lista solo puede achicarse.

/** Un valor JSON libre: lo que el esquema describe como `dict` o `Any`. */
type FreeJson<T> = [T] extends [JsonValue] ? (JsonObject extends T ? true : JsonValue extends T ? true : false) : false

/** Error que aparece en el tipo cuando el contrato y la feature no encajan. */
interface ContractMismatch<Reason extends string> {
  readonly __contractMismatch: Reason
}

/**
 * Respuesta que el contrato todavía no tipa: el endpoint del backend no
 * declara `response_model` (o declara un `dict`). La feature declara la forma
 * que espera, sin verificación. Cuando el backend tipa la respuesta, este
 * helper deja de compilar y la función pasa a `ApiResponse`.
 */
export type UntypedResponse<P extends ApiPath, M extends ApiMethod, Expected> =
  FreeJson<ApiResponse<P, M>> extends true
    ? Expected
    : ContractMismatch<'El contrato ya tipa esta respuesta: usar ApiResponse'>

// --- Frontera: de lo que dice el contrato a lo que usa la feature ----------

/**
 * Estrecha un texto del contrato a los valores que la feature conoce. El
 * contrato lo tipa como `str` (la base no lo restringe), así que un valor
 * desconocido queda en `null`, como si el campo no tuviera estado: es lo que
 * ya hacía la pantalla al no reconocerlo.
 */
export function oneOf<const T extends string>(value: string | null, allowed: readonly T[]): T | null {
  return value !== null && (allowed as readonly string[]).includes(value) ? (value as T) : null
}

/**
 * Lee con su forma de dominio un campo que el backend guarda como JSON libre
 * (un `dict` que su dominio valida, como el análisis de un adjunto). Es la
 * única aserción de forma permitida en la frontera, y solo sobre JSON.
 */
export function jsonAs<T>(value: JsonValue): T {
  return value as unknown as T
}
