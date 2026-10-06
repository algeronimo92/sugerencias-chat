import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
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
  'automations -> chats',
  'automations -> leads',
  'automations -> media',
  'automations -> platform',
  'chats -> ai',
  'chats -> automations',
  'chats -> leads',
  'chats -> media',
  'chats -> platform',
  'leads -> automations',
  'leads -> chats',
  'leads -> platform',
  'media -> chats',
  'platform -> chats',
  'platform -> leads',
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
  'features/chats/components/TemplatesPage.tsx',
  'features/leads/components/KanbanBoard.tsx',
  'features/leads/components/LeadFormDialog.tsx',
  'features/leads/components/TasksPage.tsx',
  'features/platform/components/PlatformApp.tsx',
]

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
    for (const owner of readdirSync(features)) if (existsSync(join(features, owner, 'types.ts'))) expect(existsSync(join(features, owner, 'api.ts'))).toBe(true)
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
})
