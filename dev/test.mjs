import assert from 'node:assert/strict'
import { scanAll, aggregate, sessionsRoot, localDay } from '../lib/scan.mjs'
import { num, pct, sparkline, clip } from '../lib/format.mjs'

let pass = 0
const ok = (name, fn) => { fn(); pass++; console.log('  ok', name) }
const { sessions } = scanAll({ force: true })
const t = aggregate(sessions)

console.log(`\n真实数据: ${sessions.length} 会话 @ ${sessionsRoot()}`)
assert.ok(sessions.length > 0, '应扫到会话')

ok('总数与非零', () => { assert.ok(t.totalTokens > 0); assert.ok(t.calls > 0) })
ok('聚合自洽（total = in + out + cacheRead + cacheWrite）', () => {
  const sum = t.inputTokens + t.outputTokens + t.cacheReadTokens + t.cacheWriteTokens
  assert.equal(t.totalTokens, sum)
})
ok('按天合计 = 总量', () => {
  let s = 0; for (const d of t.byDay.values()) s += d.totalTokens
  assert.equal(s, t.totalTokens)
})
ok('num()', () => { assert.equal(num(999), '999'); assert.equal(num(1500), '1.50K'); assert.equal(num(350518168), '350.5M') })
ok('pct()', () => { assert.equal(pct(1, 4), '25.0%'); assert.equal(pct(0, 0), '0%') })
ok('sparkline 长度与单值', () => { assert.equal([...sparkline([1, 2, 3])].length, 3); assert.equal([...sparkline([5])].length, 1) })
ok('localDay 稳定', () => { const d = localDay(Date.parse('2026-11-06T12:00:00+08:00')); assert.match(d, /^\d{4}-\d{2}-\d{2}$/) })
ok('clip', () => { assert.equal(clip('abcdef', 4), 'abc…') })

console.log(`\n汇总: 会话 ${t.sessions} · turn ${t.turns} · 调用 ${t.calls} · 工具 ${t.tools}`)
console.log(`token: in ${num(t.inputTokens)} / out ${num(t.outputTokens)} / cacheRead ${num(t.cacheReadTokens)} = ${num(t.totalTokens)}`)
const days = [...t.byDay.entries()].sort((a, b) => a[0].localeCompare(b[0]))
console.log('按天:', days.map(([d, v]) => `${d}=${num(v.totalTokens)}`).join(' '))
console.log('spark:', sparkline(days.map(([, v]) => v.totalTokens)))
console.log(`\n${pass} 项断言通过`)
