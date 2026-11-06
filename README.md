# dsh-usage-android

[![npm](https://img.shields.io/npm/v/dsh-usage-android.svg)](https://www.npmjs.com/package/dsh-usage-android)
[![license](https://img.shields.io/npm/l/dsh-usage-android.svg)](LICENSE)

`npm i dsh-usage-android` · [GitHub](https://github.com/Verchiel666/dsh-usage-android) · [Issues](https://github.com/Verchiel666/dsh-usage-android/issues)

会话 token 用量统计插件（DSH / DeepSeek Harness，Android · host 侧）。

## 为什么需要这个（而不是直接用现成的用量插件）

npm 上做「token 用量统计」的 DSH 插件已经有一批，但截至 2026-11-06 我查到的 5 个
**全部声明了 `dsh.client`**，也就是都带 Web UI（面板 / 侧栏 / 按钮条）：

| 包 | 形态 |
|---|---|
| `dsh-usage` 0.2.5 | Web 面板，52 周活动看板 |
| `dsh-plugin-usage` 0.6.0 | Web 面板，年度热力图 + 定价匹配 |
| `dsh-plugin-usage-meter` 1.10.0 | Web 按钮条 + 弹层图表 |
| `@lcthe/dsh-usage-monitor` 1.2.1 | Web 面板，含余额查询 |
| `@zzerx/dsh-plugin-usage-billing` 1.3.1 | Web 侧栏 / 输入框下方入口 |

而 **Android 版 DSH 引擎没有 Web Client 层**（`@dsh-android/bundle-android` 自述
"trims desktop/web/experimental rows"，引擎里没有 `dsh-client-ui-slots` / `sidebar-right` /
`client-modules` 这些 UI 组合包，App 是原生界面 + JSON-RPC）。**在手机上，带 `dsh.client` 的插件
装了也渲染不出来。**

这就是 `dsh-usage-android` 的位置：**零 UI 依赖，纯 host 侧工具**，所以在 Android 上能用。

> 说明：我只核对了这些包的 `package.json`（`dsh.client` 字段），**没有**逐个读源码确认它们是否
> 另外还注册了 host 工具。如果你在桌面/Web 端，那些面板插件可能更合适——它们确实更漂亮。

它对应官方「创造模式」Demo #7「会话统计」，但落地形态不同：官方 Demo 是 Web Client 面板
（侧边栏/右侧栏 slot），这里是 host 侧工具。

## 它能回答什么

- 这几天总共烧了多少 token？输入/输出/缓存各占多少？
- 哪天的用量最高？最近 N 天的趋势形状？
- 哪个会话最费？（按 token 排序，带轮次与调用次数）
- 缓存命中率如何？（cacheRead / total）
- 成本大概多少？（**只在你自己配了单价时才显示**，不内置价格、不假装是账单）
- 顺带一行 CPU 核数 / load / 内存占用。

## 数据从哪来

DSH 把每个会话写成 `<DSH_HOME>/sessions/<cwd-slug>/<sessionId>/session.v4.jsonl.zstd`，
每行一个事件。每次模型调用的用量在 `assistant/message` 事件的 `data.usage`：

```
{ inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, totalTokens }
```

插件用 `node:zlib` 的 `zstdDecompressSync` 解压后逐条累加。**只读**，不联网，不改任何文件。
扫描结果带 30 秒 mtime 缓存，`refresh: true` 可强制重扫。

## 工具

`usage_report`

| 参数 | 说明 |
|---|---|
| `range` | `1d` / `7d` / `30d` / `all`（默认 `7d`） |
| `groupBy` | `day`（默认）或 `session` |
| `top` | Top 会话条数，1–20（默认 5） |
| `session` | 按标题/ID 关键词过滤单个会话 |
| `refresh` | 跳过缓存强制重扫 |
| `includeSystem` | 是否附 CPU/内存行（默认 true） |

## 安装（Android 本机）

插件是纯 host 侧，不需要 Web Client，也不需要构建工具。

**方式一：profile patch 指向源码目录（本机开发用，无需发 npm）**

在 `$DSH_HOME/profiles/android/cordis.patch.yml` 追加：

```yaml
- insert:
    - id: usage
      name: /absolute/path/to/dsh-usage/index.mjs
```

`name` 必须是**字面绝对路径**。不要写成 `name: !!js "..."`：
`!!js` 表达式只在 entry 的 `config` 里求值（loader 的 `interpolate` 挂在 `internal/config` 上），
写在 `name` 位置会被当成模块名导入一个对象，引擎直接起不来。

然后重启引擎（完全退出 App 再打开）。

**方式二：从 npm 装（适合分享给别人）**

```sh
npm install dsh-usage-android@0.1.0
```

App 的插件管理里搜 `dsh-usage-android@0.1.0` 安装（**一定带版本号**），然后重启引擎。

## 命令行直用

```sh
node $HOME/work/dsh-usage/dev/cli.mjs 7d
node $HOME/work/dsh-usage/dev/cli.mjs all 论文
```

## 测试

```sh
node $HOME/work/dsh-usage/dev/test.mjs          # 数据层：8 项断言（真实日志）
node $HOME/work/host-test/rt-usage.mjs          # 真 cordis 加载：7 项断言
```

## 已知边界

- 只用 `session.v4` 格式；换格式要跟着改。
- 会话被删除后历史统计随之消失（数据源就是会话本身）。
- 不内置任何价格：DeepSeek 价格会变，成本行必须由使用者自己配单价。
- Android 上没有任何 UI 面板能力，报告是文本（工具结果 / 命令行）。

MIT.
