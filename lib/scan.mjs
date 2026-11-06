// 会话日志扫描：DSH 把每个会话写成 <root>/<cwd-slug>/<sessionId>/session.v4.jsonl.zstd。
// 每行一个事件；token 用量在 assistant/message.data.usage 上
// （inputTokens / outputTokens / cacheReadTokens / cacheWriteTokens / totalTokens）。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'

const SESSION_FILE = 'session.v4.jsonl.zstd'

/**
 * 会话日志根目录：$DSH_HOME/sessions。
 * 引擎进程的 HOME（<files>/home）与 DSH_HOME（<files>/dsh-home）不是同一个，
 * 所以按候选逐个探测，挑第一个真的有 sessions 目录的。
 */
export function sessionsRoot(env = process.env) {
  const cands = []
  const push = (p) => { if (p && !cands.includes(p)) cands.push(p) }
  if (env.DSH_HOME) push(path.join(env.DSH_HOME, 'sessions'))
  if (env.HOME) { push(path.join(env.HOME, 'dsh-home', 'sessions')); push(path.join(env.HOME, '..', 'dsh-home', 'sessions')) }
  // 插件自身位置：<files>/home/work/<pkg>/lib/scan.mjs → 上溯到 <files>
  try {
    const here = path.dirname(new URL(import.meta.url).pathname)
    let d = here
    for (let i = 0; i < 6; i++) { d = path.dirname(d); push(path.join(d, 'dsh-home', 'sessions')) }
  } catch {}
  try { push(path.join(os.homedir(), 'dsh-home', 'sessions')) } catch {}
  for (const c of cands) { try { if (fs.statSync(c).isDirectory()) return c } catch {} }
  return cands[0] || path.join(env.HOME || '.', 'dsh-home', 'sessions')
}

/** 列出所有会话文件（递归两层，跳过隐藏目录与锁文件）。 */
export function listSessionFiles(root = sessionsRoot()) {
  const out = []
  const walk = (dir, depth) => {
    let names
    try { names = fs.readdirSync(dir) } catch { return }
    for (const name of names) {
      if (name.startsWith('.')) continue
      const p = path.join(dir, name)
      let st
      try { st = fs.statSync(p) } catch { continue }
      if (st.isDirectory()) { if (depth > 0) walk(p, depth - 1); continue }
      if (name === SESSION_FILE) out.push({ file: p, id: path.basename(dir), mtime: st.mtimeMs, size: st.size })
    }
  }
  walk(root, 2)
  return out
}

const decompress = (buf) => {
  if (typeof zlib.zstdDecompressSync === 'function') return zlib.zstdDecompressSync(buf)
  throw new Error('当前 node 没有 zstd 解压能力（需要 >= 23.8 的 zlib.zstdDecompressSync）')
}

/** 读一个会话文件，返回解析后的事件数组（坏行跳过）。 */
export function readSession(file) {
  const text = decompress(fs.readFileSync(file)).toString('utf8')
  const events = []
  for (const line of text.split('\n')) {
    if (!line) continue
    try { events.push(JSON.parse(line)) } catch {}
  }
  return events
}

/** 从事件流里抽一个会话的摘要。 */
export function summarize(events, id = '') {
  const s = {
    id, title: '', cwd: '', startedAt: 0, endedAt: 0, turns: 0, calls: 0,
    inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0,
    tools: 0, model: '', byDay: new Map(),
  }
  for (const e of events) {
    const t = e?.type
    if (typeof e?.time === 'number') {
      if (!s.startedAt || e.time < s.startedAt) s.startedAt = e.time
      if (e.time > s.endedAt) s.endedAt = e.time
    }
    if (t === 'session') { s.cwd = e.data?.cwd || s.cwd; if (e.data?.createdAt) s.startedAt = Math.min(s.startedAt || e.data.createdAt, e.data.createdAt) }
    else if (t === 'session/title') { if (e.data?.title) s.title = e.data.title }
    else if (t === 'turn/start') s.turns++
    else if (t === 'tool/call') s.tools++
    else if (t === 'assistant/message') {
      const u = e.data?.usage
      if (e.data?.message?.source?.model) s.model = e.data.message.source.model
      if (!u) continue
      s.calls++
      s.inputTokens += u.inputTokens || 0
      s.outputTokens += u.outputTokens || 0
      s.cacheReadTokens += u.cacheReadTokens || 0
      s.cacheWriteTokens += u.cacheWriteTokens || 0
      s.totalTokens += u.totalTokens || (u.inputTokens || 0) + (u.outputTokens || 0) + (u.cacheReadTokens || 0) + (u.cacheWriteTokens || 0)
      const day = localDay(e.time)
      const d = s.byDay.get(day) || { calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, totalTokens: 0 }
      d.calls++
      d.inputTokens += u.inputTokens || 0
      d.outputTokens += u.outputTokens || 0
      d.cacheReadTokens += u.cacheReadTokens || 0
      d.totalTokens += u.totalTokens || (u.inputTokens || 0) + (u.outputTokens || 0) + (u.cacheReadTokens || 0)
      s.byDay.set(day, d)
    }
  }
  return s
}

/** epoch ms → 本地时区 YYYY-MM-DD（在手机上就是设备时区）。 */
export function localDay(ms) {
  const d = new Date(ms + new Date(ms).getTimezoneOffset() * 0 - 0)
  // 用本地时间格式化，避免手工加 TZ 偏移在 DST/时区上出错
  const off = new Date(ms).getTimezoneOffset() * 60000
  const local = new Date(ms - off)
  return `${local.getUTCFullYear()}-${String(local.getUTCMonth() + 1).padStart(2, '0')}-${String(local.getUTCDate()).padStart(2, '0')}`
}

/** 扫描全部会话（带 mtime 缓存），返回 { sessions, root, scannedAt, files } */
let cache = { key: '', at: 0, sessions: [] }

export function scanAll({ root = sessionsRoot(), ttlMs = 30_000, force = false } = {}) {
  const files = listSessionFiles(root)
  const key = root + '|' + files.map((f) => f.file + ':' + f.mtime).join(',')
  if (!force && cache.key === key && Date.now() - cache.at < ttlMs) return { root, files, sessions: cache.sessions, cached: true }
  const sessions = []
  for (const f of files) {
    try { sessions.push(summarize(readSession(f.file), f.id)) } catch {}
  }
  sessions.sort((a, b) => (b.endedAt || 0) - (a.endedAt || 0))
  cache = { key, at: Date.now(), sessions }
  return { root, files, sessions, cached: false }
}

/** 汇总一组会话。 */
export function aggregate(sessions) {
  const t = { sessions: sessions.length, turns: 0, calls: 0, tools: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0, byDay: new Map() }
  for (const s of sessions) {
    t.turns += s.turns; t.calls += s.calls; t.tools += s.tools
    t.inputTokens += s.inputTokens; t.outputTokens += s.outputTokens
    t.cacheReadTokens += s.cacheReadTokens; t.cacheWriteTokens += s.cacheWriteTokens
    t.totalTokens += s.totalTokens
    for (const [day, d] of s.byDay) {
      const cur = t.byDay.get(day) || { calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, totalTokens: 0 }
      cur.calls += d.calls; cur.inputTokens += d.inputTokens; cur.outputTokens += d.outputTokens
      cur.cacheReadTokens += d.cacheReadTokens; cur.totalTokens += d.totalTokens
      t.byDay.set(day, cur)
    }
  }
  return t
}

export function clearCache() { cache = { key: '', at: 0, sessions: [] } }
