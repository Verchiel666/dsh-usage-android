// 命令行直接出报告（不装插件也能用）：
//   node $HOME/work/dsh-usage/dev/cli.mjs [7d|1d|30d|all] [关键词]
import { report } from '../index.mjs'
const [range = '7d', session = ''] = process.argv.slice(2)
console.log(report({ range, session, groupBy: 'session', top: 8, refresh: true }, {}))
