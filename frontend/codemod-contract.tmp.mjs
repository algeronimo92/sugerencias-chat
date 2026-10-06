// Codemod de la fase 1: cada llamada a `client` en los api.ts toma su tipo de
// respuesta del contrato (ApiResponse<ruta, método>) y la función declara como
// retorno el tipo que la feature usaba. Se ejecuta una vez y se borra.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'

const FEATURES = 'src/features'
const SCHEMA = 'src/api/schema.d.ts'

// Rutas y métodos que existen en el contrato.
const schemaSource = ts.createSourceFile(SCHEMA, readFileSync(SCHEMA, 'utf8'), ts.ScriptTarget.Latest, true)
const contract = new Map() // ruta -> Set(métodos)
const untyped = new Set() // "método ruta" cuya respuesta exitosa es unknown
const operations = new Map() // nombre de operación -> texto
for (const statement of schemaSource.statements) {
  if (ts.isInterfaceDeclaration(statement) && statement.name.text === 'operations') {
    for (const member of statement.members) operations.set(member.name.getText(), member.getText())
  }
}
for (const statement of schemaSource.statements) {
  if (!ts.isInterfaceDeclaration(statement) || statement.name.text !== 'paths') continue
  for (const member of statement.members) {
    const path = member.name.getText().replace(/^"|"$/g, '')
    const methods = new Set()
    for (const inner of member.type.members) {
      const method = inner.name.getText()
      if (!['get', 'post', 'put', 'patch', 'delete'].includes(method) || inner.questionToken) continue
      methods.add(method)
      const operation = inner.type.getText().match(/operations\["(.+)"\]/)?.[1]
      const body = operations.get(operation) ?? ''
      const success = body.match(/\b20[0-2]: \{[\s\S]*?content: \{\s*"application\/json": ([^;]+);/)
      if (success && success[1].trim() === 'unknown') untyped.add(`${method} ${path}`)
    }
    contract.set(path, methods)
  }
}

function matchPath(pattern) {
  // pattern: segmentos literales o '*' (expresión del template).
  const segments = pattern.split('/')
  const candidates = [...contract.keys()].filter(path => {
    const parts = path.split('/')
    if (parts.length !== segments.length) return false
    return parts.every((part, index) => segments[index] === '*' ? /^\{.+\}$/.test(part) : part === segments[index])
  })
  return candidates
}

function urlPattern(node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text
  if (ts.isTemplateExpression(node)) {
    return node.head.text + node.templateSpans.map(span => '*' + span.literal.text).join('')
  }
  return null
}

const report = []
for (const feature of readdirSync(FEATURES)) {
  const file = join(FEATURES, feature, 'api.ts')
  if (!existsSync(file)) continue
  let text = readFileSync(file, 'utf8')
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
  const edits = []
  let usesContract = false

  const visit = (node, enclosing) => {
    const fn = ts.isFunctionDeclaration(node) ? node : enclosing
    if (
      ts.isCallExpression(node)
      && ts.isPropertyAccessExpression(node.expression)
      && ts.isIdentifier(node.expression.expression)
      && node.expression.expression.text === 'client'
    ) {
      const method = node.expression.name.text
      const pattern = node.arguments[0] ? urlPattern(node.arguments[0]) : null
      const where = `${file}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`
      if (!pattern) {
        report.push(`MANUAL (url dinámica) ${where}`)
      } else {
        const path = pattern.split('?')[0]
        const candidates = matchPath(path).filter(candidate => contract.get(candidate).has(method))
        if (candidates.length !== 1) {
          report.push(`MANUAL (${candidates.length} rutas para ${method} ${path}) ${where}`)
        } else {
          const contractType = `ApiResponse<'${candidates[0]}', '${method}'>`
          if (untyped.has(`${method} ${candidates[0]}`)) report.push(`SIN TIPO EN EL CONTRATO ${method} ${candidates[0]} ${where}`)
          const typeArg = node.typeArguments?.[0]
          const previous = typeArg ? typeArg.getText() : null
          if (typeArg) edits.push({ start: typeArg.getStart(), end: typeArg.getEnd(), text: contractType })
          else edits.push({ start: node.expression.getEnd(), end: node.expression.getEnd(), text: `<${contractType}>` })
          usesContract = true
          // Retorno de la función: el tipo que la feature esperaba.
          if (fn && !fn.type && previous) {
            const returnsData = fn.body?.statements.length === 1
              && ts.isReturnStatement(fn.body.statements[0])
              && /^\(\s*await client\.\w+<[\s\S]*>\([\s\S]*\)\s*\)\.data$/.test(fn.body.statements[0].expression?.getText() ?? '')
            if (returnsData) edits.push({ start: fn.parameters.end + 1, end: fn.parameters.end + 1, text: `: Promise<${previous}>` })
            else report.push(`RETORNO MANUAL ${fn.name?.text} (${previous}) ${where}`)
          }
        }
      }
    }
    ts.forEachChild(node, child => visit(child, fn))
  }
  visit(source, null)

  for (const edit of edits.sort((a, b) => b.start - a.start)) text = text.slice(0, edit.start) + edit.text + text.slice(edit.end)
  if (usesContract) {
    const importLine = "import type { ApiResponse } from '../../shared/http/contract'\n"
    text = text.replace(/(import client from ['"]\.\.\/\.\.\/shared\/http\/client['"];?\n)/, `$1${importLine}`)
    if (!text.includes(importLine)) report.push(`IMPORT MANUAL ${file}`)
  }
  writeFileSync(file, text)
}
console.log(report.join('\n'))
