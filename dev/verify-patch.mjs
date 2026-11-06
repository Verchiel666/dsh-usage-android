// 部署前检查：用引擎同款 YAML 方言（yaml 的 JSON_SCHEMA + !!js 标量）解析 profile patch，
// 确认新增行能被 Loader 正确读出——尤其 name 必须是字符串绝对路径（!!js 只对 config 求值）。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** 引擎的 node_modules：优先环境变量，其次按 <DSH_HOME>/../engine/<hash>/node_modules 自动发现。 */
function engineModules() {
  if (process.env.DSH_ENGINE_NODE_MODULES) return process.env.DSH_ENGINE_NODE_MODULES
  const dshHome = process.env.DSH_HOME
  if (!dshHome) return null
  const root = path.join(dshHome, '..', 'engine')
  let dirs = []
  try { dirs = fs.readdirSync(root) } catch { return null }
  for (const d of dirs) {
    const cand = path.join(root, d, 'node_modules')
    if (fs.existsSync(path.join(cand, 'js-yaml'))) return cand
  }
  return null
}
const ENGINE = engineModules()
if (!ENGINE) {
  console.error('找不到引擎 node_modules：设 DSH_ENGINE_NODE_MODULES，或保证 DSH_HOME 旁边有 engine/<hash>/node_modules')
  process.exit(2)
}
import { createRequire } from 'node:module'
const require = createRequire(path.join(ENGINE, 'js-yaml/package.json'))
const yaml = require(path.join(ENGINE, 'js-yaml'))

const JsExpr = new yaml.Type('tag:yaml.org,2002:js', {
  kind: 'scalar',
  resolve: (d) => typeof d === 'string',
  construct: (d) => ({ __jsExpr: d }),
})
const schema = yaml.JSON_SCHEMA.extend(JsExpr)

const target = process.argv[2] || path.join(process.env.DSH_HOME, 'profiles/android/cordis.patch.yml')
const raw = fs.readFileSync(target, 'utf8')
let doc
try { doc = yaml.load(raw, { schema }) } catch (e) { console.error('YAML 解析失败:', e.message); process.exit(1) }

let pass = 0
const ok = (name, fn) => { fn(); pass++; console.log('  ok', name) }
ok('顶层是数组', () => { if (!Array.isArray(doc)) throw new Error('不是数组') })
const inserts = doc.filter((p) => p && p.insert).flatMap((p) => p.insert)
console.log(`  共 ${doc.length} 个 patch，展开 ${inserts.length} 个 insert 行`)

const usage = inserts.find((e) => e.id === 'usage')
ok('找到 usage 行', () => { if (!usage) throw new Error('没有 id: usage') })
ok('name 是字符串（不能是 !!js 表达式对象）', () => {
  if (typeof usage.name !== 'string') throw new Error(`name 是 ${typeof usage.name}：${JSON.stringify(usage.name).slice(0, 80)}`)
})
ok('name 是绝对路径', () => { if (!usage.name.startsWith('/')) throw new Error(usage.name) })
ok('name 指向的文件存在', () => { if (!fs.existsSync(usage.name)) throw new Error(usage.name) })
ok('config 是普通对象（sessionRoot 为空串）', () => {
  if (!usage.config || usage.config.sessionRoot !== '') throw new Error(JSON.stringify(usage.config))
})
// 其它行不许被我们改坏：mcp 两行的 name 仍是包名
for (const id of ['mcp-node7-media', 'mcp-yd-admin']) {
  const e = inserts.find((x) => x.id === id)
  if (e) ok(`${id} 的 name 未被破坏`, () => { if (e.name !== '@deepseek-ai/dsh-mcp-client') throw new Error(String(e.name)) })
}

// 真 import 一次，等于 Loader 的下一步
const pluginMod = await import(usage.name)
ok('绝对路径能被 import（Loader 能加载）', () => {
  if (typeof pluginMod.apply !== 'function') throw new Error('没有导出 apply')
  if (!Array.isArray(pluginMod.inject) || pluginMod.inject[0] !== 'tools') throw new Error('inject 不是 [tools]')
})

console.log(`\n${pass} 项检查通过 · ${target}`)
