// Проверка переводов: все строки tr('…') из исходников должны быть в en.json и uk.json.
// npm run i18n:check
const { parse } = require('@babel/parser')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const files = []
;(function scan(dir) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name)
    if (fs.statSync(p).isDirectory()) scan(p)
    else if (/\.(ts|tsx)$/.test(name) && !p.includes(`${path.sep}locales${path.sep}`)) files.push(p)
  }
})(path.join(root, 'src'))

const keys = new Set()
function walk(node) {
  if (!node || typeof node.type !== 'string') return
  if (node.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === 'tr' && node.arguments[0]?.type === 'StringLiteral') {
    keys.add(node.arguments[0].value)
  }
  for (const k of Object.keys(node)) {
    if (k === 'loc' || k === 'extra') continue
    const v = node[k]
    if (Array.isArray(v)) v.forEach((c) => c && typeof c.type === 'string' && walk(c))
    else if (v && typeof v.type === 'string') walk(v)
  }
}
for (const f of files) walk(parse(fs.readFileSync(f, 'utf8'), { sourceType: 'module', plugins: ['typescript', 'jsx'] }).program)

let bad = 0
for (const lang of ['en', 'uk']) {
  const dict = JSON.parse(fs.readFileSync(path.join(root, 'src/shared/locales', `${lang}.json`), 'utf8'))
  const missing = [...keys].filter((k) => !(k in dict))
  const unused = Object.keys(dict).filter((k) => !keys.has(k))
  if (missing.length) {
    bad += missing.length
    console.log(`\n${lang}: нет перевода (${missing.length}):`)
    missing.forEach((k) => console.log('  ' + JSON.stringify(k)))
  }
  if (unused.length) console.log(`\n${lang}: лишние ключи (${unused.length}) — можно удалить`)
}
console.log(`\nСтрок в интерфейсе: ${keys.size}${bad ? `, без перевода: ${bad}` : ', все переведены'}`)
process.exit(bad ? 1 : 0)
