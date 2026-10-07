import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { basename, isAbsolute, join, relative, resolve } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const src = resolve(process.cwd(), 'src')
const features = join(src, 'features')
const shared = join(src, 'shared')

function sourceFiles(directory: string): string[] {
  if (!existsSync(directory)) return []
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? sourceFiles(path) : /\.(ts|tsx)$/.test(entry.name) ? [path] : []
  })
}

function imports(source: string): string[] {
  const file = ts.createSourceFile('source.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const found = new Set<string>()
  function visit(node: ts.Node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) found.add(node.moduleSpecifier.text)
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) found.add(node.argument.literal.text)
    if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference) && node.moduleReference.expression && ts.isStringLiteral(node.moduleReference.expression)) found.add(node.moduleReference.expression.text)
    if (ts.isCallExpression(node) && node.arguments[0] && ts.isStringLiteral(node.arguments[0]) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(node.expression) && node.expression.text === 'require')) found.add(node.arguments[0].text)
    ts.forEachChild(node, visit)
  }
  visit(file)
  return [...found]
}

function isInside(directory: string, target: string): boolean {
  const path = relative(directory, target)
  return path === '' || !path.startsWith('..') && !isAbsolute(path)
}

const graph = new Map(sourceFiles(src).map(path => [path, imports(readFileSync(path, 'utf8')).flatMap(specifier => {
  const target = ts.resolveModuleName(specifier, path, { moduleResolution: ts.ModuleResolutionKind.Bundler }, ts.sys).resolvedModule?.resolvedFileName
  return target && isInside(src, target) ? [resolve(target)] : []
})]))

function reaches(start: string, forbidden: (path: string) => boolean, edges = graph): string | undefined {
  const seen = new Set<string>()
  const pending = [start]
  while (pending.length) {
    const path = pending.pop()!
    if (seen.has(path)) continue
    seen.add(path)
    if (path !== start && forbidden(path)) return path
    pending.push(...edges.get(path) ?? [])
  }
}

// Medición inicial del refactor del frontend (fase 0). Estas listas solo
// pueden achicarse: una dependencia nueva que cierre un ciclo, o un componente
// que pase de MAX_COMPONENT_LINES, hace fallar el test. Al resolver uno, se
// quita de la lista (el test exige que no queden entradas sobrantes).

/** Dependencias entre features que hoy forman parte de un ciclo. La fase 3
 * las elimina ordenando las features en capas. */
const KNOWN_CYCLE_EDGES = [
  'ai -> chats',
  'ai -> leads',
  'ai -> media',
  'ai -> tasks',
  'automations -> leads',
  'automations -> media',
  'automations -> platform',
  'automations -> tasks',
  'automations -> templates',
  'chats -> ai',
  'chats -> automations',
  'chats -> leads',
  'chats -> media',
  'chats -> platform',
  'chats -> templates',
  'leads -> automations',
  'leads -> chats',
  'leads -> platform',
  'media -> chats',
  'media -> templates',
  'platform -> leads',
  'platform -> templates',
  'tasks -> automations',
  'tasks -> leads',
  'tasks -> platform',
  'templates -> automations',
  'templates -> leads',
  'templates -> media',
  'templates -> tasks',
]

const MAX_COMPONENT_LINES = 400

/** Componentes que hoy superan MAX_COMPONENT_LINES. La fase 8 los parte. */
const KNOWN_LARGE_COMPONENTS = [
  'features/ai/components/AiAssistantPage.tsx',
  'features/auth/components/LoginPage.tsx',
  'features/automations/components/AutomationsPage.tsx',
  'features/automations/components/MyAutomationExecutionsPage.tsx',
  'features/automations/components/VisualFlowBuilder.tsx',
  'features/automations/components/flow/FlowCanvas.tsx',
  'features/chats/components/ChatComposer.tsx',
  'features/chats/components/ChatItem.tsx',
  'features/chats/components/ChatList.tsx',
  'features/chats/components/ChatThread.tsx',
  'features/chats/components/ChatWorkspace.tsx',
  'features/chats/components/MessageBody.tsx',
  'features/chats/components/MessageBubble.tsx',
  'features/chats/components/TemplateSendDialog.tsx',
  'features/leads/components/KanbanBoard.tsx',
  'features/leads/components/LeadFormDialog.tsx',
  'features/platform/components/PlatformApp.tsx',
  'features/tasks/components/TasksPage.tsx',
  'features/templates/components/TemplatesPage.tsx',
]

const CONTRACT_TYPES = new Set(['ApiResponse'])

/** Features de solo modelo: tipos y reglas sin pedidos HTTP (no tienen api.ts). */
const MODEL_ONLY_FEATURES = new Set(['whatsapp'])

/** Piezas internas de features que app/ todavía importa directo. La fase 3
 * las publica como puntos de entrada; la lista solo puede achicarse. */
const KNOWN_APP_INTERNAL_IMPORTS = [
  'app/layout.tsx -> features/auth/queries.ts',
  'app/layout.tsx -> features/chats/hooks/useChatFiltersState.ts',
  'app/layout.tsx -> features/chats/layoutContext.ts',
  'app/layout.tsx -> features/chats/queries.ts',
  'app/layout.tsx -> features/notifications/components/NotificationCenter.tsx',
  'app/layout.tsx -> features/notifications/hooks/useNotifications.ts',
  'app/layout.tsx -> features/platform/components/SettingsDialog.tsx',
  'app/routes.tsx -> features/auth/queries.ts',
  'app/routes.tsx -> features/chats/components/ChatWorkspace.tsx',
  'app/routes.tsx -> features/chats/layoutContext.ts',
  'app/routes.tsx -> features/chats/useOpenChat.ts',
  'app/routes.tsx -> features/leads/components/DashboardPage.tsx',
  'app/routes.tsx -> features/platform/components/CatalogsPage.tsx',
]

/** Punto de entrada de una feature para app/: su public/ o un archivo de
 * nivel superior que publica una pantalla, un diálogo o sus tipos. */
const FEATURE_ENTRY_FILE = /^(index|types|page|[a-z-]+-page|dialog)\.tsx?$/

const QUERY_KEY_CALLS = new Set(['setQueryData', 'getQueryData', 'getQueryState', 'fetchQuery', 'prefetchQuery'])

/** Donde se escriben claves de caché: los keys.ts de cada feature y la clave
 * de la sesión, que la guarda de la app lee desde shared. */
const isKeyFile = (path: string) => basename(path) === 'keys.ts' || isInside(join(src, 'shared', 'queryClient.ts'), path)

function parse(path: string) {
  return ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
}

function walkNodes(node: ts.Node, visit: (node: ts.Node) => void) {
  visit(node)
  ts.forEachChild(node, child => walkNodes(child, visit))
}

/** Llamadas `client.get/post/...` de un archivo. */
function httpCalls(path: string): ts.CallExpression[] {
  const calls: ts.CallExpression[] = []
  walkNodes(parse(path), node => {
    if (
      ts.isCallExpression(node)
      && ts.isPropertyAccessExpression(node.expression)
      && ts.isIdentifier(node.expression.expression)
      && node.expression.expression.text === 'client'
      && ['get', 'post', 'put', 'patch', 'delete'].includes(node.expression.name.text)
    ) calls.push(node)
  })
  return calls
}

const productionFiles = () => sourceFiles(src).filter(path => !isTestOrStory(path) && !path.endsWith('.d.ts'))

const isTestOrStory = (path: string) => /\.(test|stories)\.tsx?$/.test(path)

function featureOf(path: string): string | undefined {
  if (!isInside(features, path)) return undefined
  return relative(features, path).split(/[\\/]/)[0]
}

/** Grafo entre features: A -> B si algún archivo de producción de A importa
 * uno de B. */
function featureEdges(): Map<string, Set<string>> {
  const edges = new Map<string, Set<string>>()
  for (const [path, targets] of graph) {
    const owner = featureOf(path)
    if (!owner || isTestOrStory(path)) continue
    for (const target of targets) {
      const other = featureOf(target)
      if (!other || other === owner) continue
      if (!edges.has(owner)) edges.set(owner, new Set())
      edges.get(owner)!.add(other)
    }
  }
  return edges
}

describe('feature architecture', () => {
  it('parses side-effect, dynamic, type, require and re-export imports', () => {
    expect(imports("import './side'; export { x } from './bridge'; const x = import('./dynamic'); type T = import('./type').T; import y = require('./require')")).toEqual(['./side', './bridge', './dynamic', './type', './require'])
  })

  it('detects transitive dependencies through a compatibility bridge', () => {
    const edges = new Map([['shared', ['legacy']], ['legacy', ['feature']]])
    expect(reaches('shared', path => path === 'feature', edges)).toBe('feature')
  })

  it('keeps shared independent from features and application composition, transitively', () => {
    const violations = sourceFiles(shared).flatMap(path => {
      const target = reaches(path, candidate => isInside(features, candidate) || isInside(join(src, 'app'), candidate))
      return target ? [relative(src, path) + ' -> ' + relative(src, target)] : []
    })
    expect(violations).toEqual([])
  })

  it('retires global business folders instead of hiding them behind re-exports', () => {
    for (const folder of ['components', 'hooks', 'domain', 'utils', 'types', 'platform']) expect(sourceFiles(join(src, folder))).toEqual([])
  })

  it('uses explicit contracts when consuming another feature', () => {
    const violations = sourceFiles(features).flatMap(path => {
      const owner = relative(features, path).split(/[\\/]/)[0]
      return (graph.get(path) ?? []).filter(target => {
        if (isInside(join(src, 'app'), target)) return true
        if (!isInside(features, target)) return false
        const parts = relative(features, target).split(/[\\/]/)
        const ownerContract = parts.length === 2 && ['types.ts', 'page.ts', 'index.ts'].includes(parts[1])
        return parts[0] !== owner && parts[1] !== 'public' && !ownerContract
      }).map(target => relative(src, path) + ' -> ' + relative(src, target))
    })
    expect(violations).toEqual([])
  })

  it('keeps HTTP requests in feature API adapters, not hooks or components', () => {
    const violations = sourceFiles(features).filter(path => !path.endsWith('api.ts') && !path.includes('.test.')).filter(path => imports(readFileSync(path, 'utf8')).some(spec => spec.includes('shared/http/client')))
    expect(violations.map(path => relative(src, path))).toEqual([])
    for (const owner of readdirSync(features)) if (existsSync(join(features, owner, 'types.ts')) && !MODEL_ONLY_FEATURES.has(owner)) expect(existsSync(join(features, owner, 'api.ts'))).toBe(true)
  })

  it('separates application routes, layout, and providers', () => {
    expect(readFileSync(join(src, 'app/App.tsx'), 'utf8')).toContain('<AppRoutes />')
    const routes = readFileSync(join(src, 'app/routes.tsx'), 'utf8')
    expect(routes).toContain('from "./layout"')
    expect(routes).toContain('from "./providers"')
  })

  it('does not add dependencies that close a cycle between features', () => {
    const edges = featureEdges()
    const reachesBack = (from: string, to: string) => reaches(from, path => path === to, new Map([...edges].map(([key, value]) => [key, [...value]])))
    const cycleEdges = [...edges].flatMap(([owner, targets]) => [...targets].filter(target => reachesBack(target, owner)).map(target => `${owner} -> ${target}`))
    expect(cycleEdges.sort()).toEqual(KNOWN_CYCLE_EDGES)
  })

  it(`keeps components under ${MAX_COMPONENT_LINES} lines`, () => {
    const large = sourceFiles(src)
      .filter(path => path.endsWith('.tsx') && !isTestOrStory(path))
      .filter(path => readFileSync(path, 'utf8').split('\n').length > MAX_COMPONENT_LINES)
      .map(path => relative(src, path).split(/[\\/]/).join('/'))
      .sort()
    expect(large).toEqual(KNOWN_LARGE_COMPONENTS)
  })

  it('reads the backend base URL only in shared/config', () => {
    const readers = productionFiles()
      .filter(path => readFileSync(path, 'utf8').includes('VITE_API_BASE_URL'))
      .map(path => relative(src, path).split(/[\\/]/).join('/'))
    expect(readers).toEqual(['shared/config.ts'])
  })

  it('exposes API adapters as plain functions with domain names', () => {
    const violations = sourceFiles(features).filter(path => path.endsWith('api.ts')).flatMap(path => parse(path).statements.flatMap(node => {
      if (!ts.isFunctionDeclaration(node) || !node.name || !node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)) return []
      const name = `${relative(src, path)}: ${node.name.text}`
      const statements = node.body?.statements ?? []
      const returnsFunction = statements.length === 1 && ts.isReturnStatement(statements[0]) && !!statements[0].expression && ts.isArrowFunction(statements[0].expression)
      return [
        ...(/\d$/.test(node.name.text) ? [`${name} termina en número`] : []),
        ...(returnsFunction ? [`${name} devuelve una función`] : []),
      ]
    }))
    expect(violations).toEqual([])
  })

  it('types every HTTP response from the contract', () => {
    const violations = productionFiles().flatMap(path => httpCalls(path).flatMap(call => {
      const typeArgument = call.typeArguments?.[0]
      const contractType = typeArgument && ts.isTypeReferenceNode(typeArgument) && ts.isIdentifier(typeArgument.typeName) && CONTRACT_TYPES.has(typeArgument.typeName.text)
      return contractType ? [] : [`${relative(src, path)}: ${call.getText().slice(0, 80)}`]
    }))
    expect(violations).toEqual([])
  })

  it('writes query keys only in the keys.ts of each feature', () => {
    const violations = productionFiles().filter(path => !isKeyFile(path)).flatMap(path => {
      const found: string[] = []
      walkNodes(parse(path), node => {
        const literalKey = (
          ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) && ['queryKey', 'mutationKey'].includes(node.name.text)
          && ts.isArrayLiteralExpression(node.initializer)
        ) || (
          ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && QUERY_KEY_CALLS.has(node.expression.name.text)
          && !!node.arguments[0] && ts.isArrayLiteralExpression(node.arguments[0])
        )
        if (literalKey) found.push(`${relative(src, path).split(/[\\/]/).join('/')}: ${node.getText().slice(0, 60)}`)
      })
      return found
    })
    expect(violations).toEqual([])
  })

  it('keeps realtime/ independent from features and app, transitively', () => {
    const violations = sourceFiles(join(src, 'realtime')).filter(path => !isTestOrStory(path)).flatMap(path => {
      const target = reaches(path, candidate => isInside(features, candidate) || isInside(join(src, 'app'), candidate))
      return target ? [relative(src, path) + ' -> ' + relative(src, target)] : []
    })
    expect(violations).toEqual([])
  })

  it('lets app/ reach features only through their entry points', () => {
    const violations = sourceFiles(join(src, 'app')).filter(path => !isTestOrStory(path)).flatMap(path =>
      (graph.get(path) ?? []).filter(target => {
        if (!isInside(features, target)) return false
        const parts = relative(features, target).split(/[\\/]/)
        return parts[1] !== 'public' && !(parts.length === 2 && FEATURE_ENTRY_FILE.test(parts[1]))
      }).map(target => `${relative(src, path)} -> ${relative(src, target)}`.split(/[\\/]/).join('/')),
    )
    expect([...new Set(violations)].sort()).toEqual(KNOWN_APP_INTERNAL_IMPORTS)
  })
})
