// 手机屏友好的数字/图表格式化。
const UNITS = [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K']]

/** 1234567 → "1.23M"；小于 1000 原样。 */
export function num(n) {
  const v = Number(n) || 0
  const a = Math.abs(v)
  for (const [base, suffix] of UNITS) {
    if (a >= base) {
      const x = v / base
      return (x >= 10 ? x.toFixed(1) : x.toFixed(2)) + suffix
    }
  }
  return String(Math.round(v))
}

/** 百分比，两位有效。 */
export function pct(part, whole) {
  if (!whole) return '0%'
  const p = (part / whole) * 100
  return (p >= 10 ? p.toFixed(1) : p.toFixed(2)) + '%'
}

const BARS = '▁▂▃▄▅▆▇█'

/** 数字数组 → 文本 sparkline（等宽、无依赖）。 */
export function sparkline(values) {
  const v = values.map((x) => Number(x) || 0)
  if (!v.length) return ''
  const max = Math.max(...v)
  const min = Math.min(...v)
  if (max === min) return BARS[3].repeat(v.length)
  const step = (BARS.length - 1) / (max - min)
  return v.map((x) => {
    const i = Math.min(BARS.length - 1, Math.max(0, Math.round((x - min) * step)))
    return BARS[i]
  }).join('')
}

/** epoch ms → 本地 "MM-DD HH:mm" */
export function stamp(ms) {
  if (!ms) return '—'
  const d = new Date(ms)
  const p = (x) => String(x).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** 截断到 n 个字符（按码点，不切断 emoji）。 */
export function clip(s, n = 24) {
  const a = [...String(s || '')]
  return a.length <= n ? a.join('') : a.slice(0, n - 1).join('') + '…'
}

/** 按 $/1M token 估算成本；prices 缺省或全 0 时返回 null（不伪造价格）。 */
export function costOf(t, prices) {
  if (!prices) return null
  const { input = 0, output = 0, cacheRead = 0 } = prices
  if (!input && !output && !cacheRead) return null
  return (t.inputTokens * input + t.outputTokens * output + t.cacheReadTokens * cacheRead) / 1e6
}
