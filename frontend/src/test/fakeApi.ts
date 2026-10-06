/**
 * Backend falso a nivel de red para los tests.
 *
 * Reemplaza el adaptador de axios del cliente compartido: los tests declaran
 * qué responde cada endpoint (método + ruta) y leen los requests que llegaron.
 * Como intercepta la red y no funciones internas, un test escrito así no se
 * rompe cuando se renombra o se mueve la función que hace el request: solo
 * cuando cambia lo que viaja por HTTP.
 *
 * Un request sin respuesta declarada contesta 404, como un endpoint que no
 * existe, y queda registrado igual para poder verificarlo.
 */

import { AxiosError, AxiosHeaders, type AxiosAdapter, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios'
import { afterEach, beforeEach } from 'vitest'

import client from '../shared/http/client'

export type Method = 'get' | 'post' | 'put' | 'patch' | 'delete'

export interface FakeRequest {
  method: Method
  path: string
  params: Record<string, unknown>
  body: unknown
}

export interface FakeReply {
  status?: number
  data?: unknown
}

type Responder = (request: FakeRequest) => FakeReply | Promise<FakeReply>

interface Route {
  method: Method
  matches: (path: string) => boolean
  respond: Responder
}

function toMatcher(pattern: string | RegExp): (path: string) => boolean {
  return typeof pattern === 'string' ? path => path === pattern : path => pattern.test(path)
}

function parseBody(data: unknown): unknown {
  if (typeof data !== 'string') return data ?? null
  try {
    return JSON.parse(data)
  } catch {
    return data
  }
}

export class FakeApi {
  readonly requests: FakeRequest[] = []
  private routes: Route[] = []

  /** Declara la respuesta de un endpoint. La última declaración gana. */
  on(method: Method, pattern: string | RegExp, reply: FakeReply | Responder): this {
    const respond = typeof reply === 'function' ? reply : () => reply
    this.routes.unshift({ method, matches: toMatcher(pattern), respond })
    return this
  }

  /** Requests recibidos para un método y ruta. */
  calls(method: Method, pattern: string | RegExp): FakeRequest[] {
    const matches = toMatcher(pattern)
    return this.requests.filter(request => request.method === method && matches(request.path))
  }

  readonly adapter: AxiosAdapter = async (config: InternalAxiosRequestConfig) => {
    const method = (config.method ?? 'get').toLowerCase() as Method
    const url = new URL(config.url ?? '', 'http://fake.test')
    const params: Record<string, unknown> = { ...Object.fromEntries(url.searchParams), ...(config.params ?? {}) }
    const request: FakeRequest = { method, path: url.pathname, params, body: parseBody(config.data) }
    this.requests.push(request)

    const route = this.routes.find(candidate => candidate.method === method && candidate.matches(request.path))
    const reply = route ? await route.respond(request) : { status: 404, data: { detail: 'Not Found' } }
    const status = reply.status ?? 200
    const response: AxiosResponse = {
      data: reply.data ?? null,
      status,
      statusText: String(status),
      headers: new AxiosHeaders(),
      config,
    }
    if (status >= 400) {
      throw new AxiosError(`Request failed with status code ${status}`, AxiosError.ERR_BAD_RESPONSE, config, null, response)
    }
    return response
  }
}

/** Instala un backend falso nuevo en el cliente compartido antes de cada test
 * del archivo. Se llama a nivel de módulo; `api.current` es el del test en
 * curso. */
export function installFakeApi(): { readonly current: FakeApi } {
  const handle = { current: new FakeApi() }
  let previous: typeof client.defaults.adapter
  beforeEach(() => {
    handle.current = new FakeApi()
    previous = client.defaults.adapter
    client.defaults.adapter = handle.current.adapter
  })
  afterEach(() => {
    client.defaults.adapter = previous
  })
  return handle
}

/** Una promesa que el test resuelve cuando quiere: sirve para observar el
 * estado intermedio (la burbuja optimista) antes de que el servidor conteste. */
export function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}
