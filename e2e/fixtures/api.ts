import type { Page, Route } from '@playwright/test'
import type { ApiMethod, ApiPath, ApiResponse } from '../../frontend/src/shared/http/contract'

/**
 * Backend simulado en la red del navegador.
 *
 * Las respuestas se declaran con el tipo del contrato (`ApiResponse`, que sale
 * del OpenAPI): si el backend cambia un campo, `npm run typecheck` falla acá
 * en vez de dejar una prueba verde contra una respuesta que ya no existe.
 *
 * Un pedido que nadie declaró responde 501 y hace fallar la prueba al
 * terminar (ver fixtures/test.ts): una pantalla dibujada sobre un error
 * silencioso no prueba nada.
 */

interface Request {
  url: URL
  body: unknown
}

interface Reply {
  status: number
  body?: unknown
}

type Responder<T> = T | ((request: Request) => T | Reply)

interface Handler {
  method: string
  pattern: RegExp
  respond: Responder<unknown>
}

export interface RecordedCall {
  method: string
  path: string
  body: unknown
}

function isReply(value: unknown): value is Reply {
  return typeof value === 'object' && value !== null && 'status' in value
    && typeof (value as Reply).status === 'number' && Object.keys(value).every(key => key === 'status' || key === 'body')
}

// Un parámetro de ruta solo acepta ids numéricos (los de los fixtures). Con
// "cualquier segmento", `/api/chats/{chat_id}` atendía también a
// `/api/chats/sellers` y le devolvía un chat a quien esperaba una lista.
function pathPattern(path: string) {
  const escaped = path.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\{[^}]+\}/g, '[0-9]+')
  return new RegExp(`^${escaped}$`)
}

export class MockApi {
  private handlers: Handler[] = []
  readonly unhandled: string[] = []
  readonly recorded: RecordedCall[] = []

  /** Declara la respuesta de `método ruta`. La última declaración gana. */
  on<P extends ApiPath, M extends ApiMethod>(method: M, path: P, respond: Responder<ApiResponse<P, M>>): this {
    this.handlers.push({ method, pattern: pathPattern(path), respond })
    return this
  }

  /** Respuesta de error: no tiene la forma del contrato. */
  fail(method: ApiMethod, path: ApiPath, status: number, detail = 'Error simulado'): this {
    this.handlers.push({ method, pattern: pathPattern(path), respond: () => ({ status, body: { detail } }) })
    return this
  }

  calls(method: ApiMethod, path: ApiPath): RecordedCall[] {
    const pattern = pathPattern(path)
    return this.recorded.filter(call => call.method === method && pattern.test(call.path))
  }

  async install(page: Page) {
    await page.route(/^https?:\/\/[^/]+\/(api|media)\//, route => this.handle(route))
    // El tiempo real no participa de estas pruebas: el socket se acepta y
    // queda callado para que la app no entre en su bucle de reconexión.
    await page.routeWebSocket(/\/ws\//, () => {})
  }

  private async handle(route: Route) {
    const request = route.request()
    const url = new URL(request.url())
    const method = request.method().toLowerCase()
    let body: unknown = null
    try {
      body = request.postDataJSON()
    } catch {
      body = request.postData()
    }
    this.recorded.push({ method, path: url.pathname, body })

    const handler = this.handlers.findLast(item => item.method === method && item.pattern.test(url.pathname))
    if (!handler) {
      this.unhandled.push(`${method.toUpperCase()} ${url.pathname}${url.search}`)
      await route.fulfill({ status: 501, json: { detail: 'Pedido sin respuesta simulada' } })
      return
    }
    const result = typeof handler.respond === 'function'
      ? (handler.respond as (request: Request) => unknown)({ url, body })
      : handler.respond
    if (isReply(result)) {
      await route.fulfill({ status: result.status, json: result.body ?? null })
      return
    }
    if (result === undefined) {
      await route.fulfill({ status: 204 })
      return
    }
    await route.fulfill({ status: 200, json: result })
  }
}
