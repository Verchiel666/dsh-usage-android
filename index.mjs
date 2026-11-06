// dsh-usage — 会话 token 用量统计（官方创造模式 Demo #7「会话统计」在 Android 上的
// host 侧落地版：手机 App 没有 Web Client 层，插件只能贡献工具/服务，不能画面板）。
//
// 数据源是本机会话日志 <DSH_HOME>/sessions/**/session.v4.jsonl.zstd，逐条 assistant/message
// 的 data.usage 累加。只读、不联网、不改任何文件。

import os from 'node:os'
import { scanAll, aggregate, sessionsRoot } from './lib/scan.mjs'
import { num, pct, sparkline, stamp, clip, costOf } from './lib/format.mjs'

export const name = 'usage'
export const inject = ['tools']

const RANGES = { '1d': 1, '7d': 7, '30d': 30, all: Infinity }

const text = (t) => [{ type: 'text', text: t }]
const renderer = (_args, value) => (Array.isArray(value?.content) ? value.content : text(JSON.stringify(value, null, 2)))

/** 按本地时区把 now 往回推 n 天，得到 YYYY-MM-DD 下界。 */
function boundary(days) {
  if (!Number.isFinite(days)) return '0000-00-00'
  const d = new Date()
  d.setDate(d.getDate() - (days - 1))
  const p = (x) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** 过滤出时间窗内的会话（用会话最后活动时间判断）。 */
function inRange(sessions, days) {
  const from = boundary(days)
  if (from === '0000-00-00') return sessions
  const fromMs = new Date(from + 'T00:00:00').getTime()
  return sessions.filter((s) => (s.endedAt || 0) >= fromMs)
}

/** 只统计下界之后发生的调用：重算 byDay 并把窗口内会话裁剪到窗口。 */
function clipToRange(agg, days) {
  const from = boundary(days)
  if (from === '0000-00-00') return agg
  const byDay = new Map([...agg.byDay].filter(([d]) => d >= from))
  const out = { ...agg, byDay, sessions: 0, turns: 0, calls: 0, tools: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0 }
  for (const d of byDay.values()) {
    out.calls += d.calls; out.inputTokens += d.inputTokens; out.outputTokens += d.outputTokens
    out.cacheReadTokens += d.cacheReadTokens; out.totalTokens += d.totalTokens
  }
  return out
}

function systemLine() {
  const cpus = typeof os.cpus === 'function' ? os.cpus() : []
  const cores = cpus.length || os.availableParallelism?.() || 0
  const load = typeof os.loadavg === 'function' ? os.loadavg()[0] : 0
  const used = (os.totalmem() - os.freemem()) / os.totalmem() * 100
  return `CPU ${cores} 核 · load ${load.toFixed(2)} · 内存 ${used.toFixed(0)}% 占用`
}

function report({ range = '7d', groupBy = 'day', top = 5, session: filter = '', refresh = false, includeSystem = true } = {}, config) {
  const days = RANGES[range] ?? 7
  const { sessions, root, files, cached } = scanAll({ root: config.sessionRoot || sessionsRoot(), force: !!refresh, ttlMs: 30_000 })
  if (!sessions.length) {
    return `会话日志为空：${root}\n（还没有任何带 token 用量的会话记录）`
  }
  let pool = sessions
  if (filter) {
    const q = String(filter).toLowerCase()
    pool = sessions.filter((s) => s.title.toLowerCase().includes(q) || s.id.toLowerCase().includes(q))
    if (!pool.length) return `没有标题/ID 匹配「${filter}」的会话。`
  }
  const windowed = inRange(pool, days)
  const agg = clipToRange(aggregate(windowed.length ? windowed : pool), days)
  agg.sessions = windowed.length || pool.length
  agg.turns = (windowed.length ? windowed : pool).reduce((a, s) => a + s.turns, 0)
  agg.tools = (windowed.length ? windowed : pool).reduce((a, s) => a + s.tools, 0)

  const label = range === 'all' ? '全部时间' : range === '1d' ? '今天' : `近 ${days} 天`
  const lines = []
  lines.push(`📊 会话用量 · ${label}`)
  lines.push(`${num(agg.totalTokens)} tok · ${agg.sessions} 会话 · ${agg.turns} 轮 · ${num(agg.calls)} 次调用`)
  const cacheShare = agg.totalTokens ? agg.cacheReadTokens / agg.totalTokens : 0
  lines.push(`输入 ${num(agg.inputTokens)} · 输出 ${num(agg.outputTokens)}`)
  lines.push(`缓存读 ${num(agg.cacheReadTokens)}（占 ${pct(agg.cacheReadTokens, agg.totalTokens)}）`)

  const cost = costOf(agg, config.prices)
  if (cost != null) {
    const cur = config.currency || '$'
    const budget = Number(config.budget) || 0
    lines.push(budget > 0
      ? `成本 ≈ ${cur}${cost.toFixed(3)} / 预算 ${cur}${budget}（${pct(cost, budget)}）`
      : `成本 ≈ ${cur}${cost.toFixed(3)}（按自定义单价，非官方账单）`)
  }

  const days_ = [...agg.byDay.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  if (days_.length) {
    lines.push('')
    lines.push(`按天 ${sparkline(days_.map(([, v]) => v.totalTokens))}  ${days_.length ? `${days_[0][0]} → ${days_[days_.length - 1][0]}` : ''}`)
    const tail = days_.slice(-7)
    for (const [d, v] of tail) lines.push(`  ${d.slice(5)}  ${num(v.totalTokens).padStart(8)}  ${String(v.calls).padStart(4)} 次`)
    if (days_.length > tail.length) lines.push(`  …更早 ${days_.length - tail.length} 天合计 ${num(days_.slice(0, -tail.length).reduce((a, [, v]) => a + v.totalTokens, 0))}`)
  }

  if (groupBy === 'session' || range !== '1d') {
    const ranked = windowed.slice().sort((a, b) => b.totalTokens - a.totalTokens).slice(0, Math.min(Math.max(Number(top) || 5, 1), 20))
    if (ranked.length) {
      lines.push('')
      lines.push(`Top 会话`)
      for (const s of ranked) {
        lines.push(`  ${num(s.totalTokens).padStart(8)}  ${clip(s.title || s.id, 22)}`)
        lines.push(`            ${s.turns} 轮 · ${num(s.calls)} 调用 · ${stamp(s.endedAt)}`)
      }
    }
  }

  if (includeSystem) {
    lines.push('')
    lines.push(systemLine())
  }
  lines.push('')
  lines.push(`${files.length} 份会话日志 · ${cached ? '缓存' : '刚扫描'} · ${root}`)
  return lines.join('\n')
}

export function apply(ctx, config = {}) {
  const cfg = {
    prices: config.prices || null,
    currency: config.currency || '$',
    budget: config.budget || 0,
    sessionRoot: config.sessionRoot || '',
  }

  const off = ctx.tools.register({
    name: 'usage_report',
    description: [
      '统计本机会话的 token 用量（总消耗、输入/输出/缓存、按天时间线、Top 会话），数据直接读本机会话日志。',
      '用于回答「这几天烧了多少 token」「哪个会话最费」「缓存命中如何」「成本大概多少」。',
      'range: 1d / 7d / 30d / all；groupBy: day / session；session: 按标题关键词过滤；refresh: 跳过 30 秒缓存重扫。',
      '[risk: read (read-only); 只读会话日志，不联网、不改文件]',
    ].join(' '),
    parameters: {
      type: 'object',
      properties: {
        range: { type: 'string', description: '时间窗：1d / 7d / 30d / all（默认 7d）' },
        groupBy: { type: 'string', description: '明细分组：day（按天，默认）或 session（按会话）' },
        top: { type: 'number', description: 'Top 会话条数，1–20（默认 5）' },
        session: { type: 'string', description: '按会话标题或 ID 的关键词过滤' },
        refresh: { type: 'boolean', description: '跳过扫描缓存，强制重扫全部日志' },
        includeSystem: { type: 'boolean', description: '末尾是否附 CPU/内存一行（默认 true）' },
      },
    },
    timeoutMs: 60_000,
    isConcurrencySafe: () => true,
    output: { schema: {}, render: renderer },
    async execute(args) {
      const t = report(args || {}, cfg)
      return { content: text(t) }
    },
  })

  // 显式把注销器挂进 effect：真 dsh 的 tools 服务会自己追踪，假服务/其它宿主则不保证。
  if (typeof ctx.effect === 'function' && typeof off === 'function') ctx.effect(() => off)

  const logger = typeof ctx.logger === 'function' ? ctx.logger('usage') : null
  logger?.info?.(`会话用量统计已就绪（prices ${cfg.prices ? '已配置' : '未配置'}）`)
}

// 供测试直接调用
export { report }
