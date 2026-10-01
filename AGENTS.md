# AGENTS.md — dsh-study-coach

## 改界面之前，先读 `design.md`

**这条是硬要求。** 面板的视觉规范全部写在 [`design.md`](design.md) 里：配色（近黑三层 / 白字
四级 / 一条信号青）、字号表与字重阶梯、间距刻度、组件（按钮 / 卡片 / 导航栏 / 表单 / 标签 /
列表 / 进度条 / 空态，每块都带能直接抄的 CSS）、**造型动机**（细规 / 角包 / 切角 / 斜纹 /
菱形 / 索引字 / 硬偏移，一个组件只许用一样）、层次与阴影、Do/Don't。

写新页面、或者动 `assets/style.css` / `assets/practice.css` / `assets/read.css` / `assets/graph.css` 之前：

1. 先读 `design.md`。
2. 色值、字号、字重、行高、间距、圆角一律照它的表来。**别现编一个 15.5px、7px 圆角，或者一个
   表里没有的色值** ——规范里没有的，先想清楚再发明，大多数时候你要的那一条已经在里面了。
3. 规则里**不写死色值**，一律走 `var(--x)`；`color-mix()` 混变量可以。
4. 唯一的事实来源是 `assets/style.css` 顶部的 `:root`（**深色，默认**）与 `html[data-theme="light"]`
   （纸白那一档）；造型那一层集中在同一个文件末尾的「方舟层」。
   `design.md` 与 CSS 不一致时，**以 CSS 为准，并把 `design.md` 改回来**。
5. 加了一个新 token、或者改了刻度，要一起动四处：`:root`、`html[data-theme="light"]`、
   `practice.css` / `graph.css` 里那些 `var(--x, 兜底色)` 的兜底值、以及 `lib/review.js` 顶上那两块色板。
6. 显示字体是 `assets/fonts/` 里的 Rajdhani（SIL OFL 1.1，随包发，`OFL.txt` 别删）。它没有汉字，
   **中文一律落回系统字族、也不加字距**；加字距的只有拉丁编号、数字、路径。

## 常用命令

```bash
node --test                 # 全量测试（不要写 node --test test/，这个 Node 上会把目录当测试文件跑挂）
node scripts/check-live.mjs # 探一遍正在跑的 DSH，看哪些路由还是旧代码
node scripts/preview.mjs    # 不用 DSH，直接把面板起在 19390（改前端时省一次重启）
```

`assets/*` 与 `lib/client.js` 是每次请求 / 每次页面加载现读磁盘的，改完刷新就见效；
`lib/` 里**其它**文件和 `package.json` 是 DSH 启动时加载的，**必须重启 DSH**。

## `lib/client.js` 不是普通模块

它是**设置 → 学习教练**那一页（「设置 → 内置插件 → 学习教练」是同一个页面的另一个入口），宿主在浏览器里执行的一段脚本（壳子
`window.__ModuleLoader__.load({id, factory})`，跟 `dsh-talk` 一个形状）。改它之前记住：

1. `require` 只能取平台种子表里的模块（react / react/jsx-runtime / cordis / 静态 UI 库），
   外加 `package.json` 里 `dsh.client.inject` 列出的包。**多要一个没列进去的包 = 静默失败。**
2. `exports` 只导出 `apply` / `inject` / `name`；`inject` 是 cordis 服务名，
   `dsh.client.inject` 是客户端模块包名，两码事。
3. 样式走 DSH 主题 token `--dsw-alias-*`，**不要**用 `assets/style.css` 那套 `--ink` / `--card`
   ——那套在 DSH 页面里没有值。`test/client.test.js` 钉住了这一条。
   另外两条铁律（都是被坑出来的）：
   - **`--dsw-alias-bg-base` 是「背景」语义，永远不要拿它当文字色。** 装了
     `dsh-plugin-wallpaper-engine` 之后它会被改成 `transparent`，`color: var(--dsw-alias-bg-base)`
     的实心按钮就成了「有面没字」——用户报的「跳转按钮看不见内容」就是这个。文字只用
     `label-primary` / `label-secondary`，面用 `bg-layer-1` / `bg-layer-2` / `bg-overlay`。
   - **别名层随时可能被别的插件改写**（壁纸插件就把 `bg-layer-*` / `border-l2` / `brand-primary`
     整套换掉，但**不碰** `bg-overlay`），所以每个 token 都要写实色兜底：`var(--dsw-alias-x, 兜底)`。
     上面两条由 `test/client.test.js` 的 CSS 钉子守着（顺带：那个测试里别拿整份源码做断言，
     文件头注释里也在讲这些坏话）。
4. `package.json` 的 `dsh.client` / `exports["./client"]` 改了要重启 DSH 才认（bundle 清单是启动时读的）。
   `/study/api/panel`（`lib/` 那一半）同样要重启；**`lib/client.js` 本身不用**——它是页面加载时现读的，
   改完刷新设置页就见效。

插件自己那个网页面板（`assets/`）仍然照 `design.md` 走，两套配色体系别互相串。

## 面板那条线只认「学习教练」模式的会话

`lib/chat.js`（读会话）和 `lib/bridge.js`（往会话投话）都以 `agentPreset === PRESET_ID`
（`lib/preset.js:59`，`'study-coach'`）为准。判据**只在 `lib/session-preset.js` 里写一份**
（`presetOf` / `hasPresetChannel` / `learningSessions`），别在两边各写一遍。

- 预设只能从**会话投影**里读：`item.projections.values.agentPreset`。`SessionSummary` 上
  **没有** `agentPreset`（也没有 `title`），DSH 自己也是读投影的。
- 宿主整份清单都不发投影时**不要筛**：`filtered:false` 说的是「这次没敢筛」，不是「筛完正好没有」。
  面板据此决定说不说「只看学习模式」，别把老宿主筛成一片空白。
- `chat.history({sessionId})` 对显式带进来的 id 也要核一遍，不在名单里就直接拒绝、**不去读那条日志**；
  投递挑不到学习会话时宁可回 `ok:false`（话还在 `inbox.json` 里），也不许掉进别的会话。
- 面板自己开得出来一个：对话页那颗「＋ 新建」走 `POST /study/api/chat/new` → `chat.create()` →
  `sessionController.create(newSessionRequest())`。**刚建出来的会话投影还没落地**，严格筛会把学生自己刚开的那一个筛掉——
  `rememberFresh(sessionId)` / `isFresh(sessionId)`（同样只在 `lib/session-preset.js` 里）就是那张放行表，
  `learningSessions` 与 `history` 都认它；预设号只在 `newSessionRequest()` 里出现一次，路由里别重写一遍。
- 这些由 `test/session-preset.test.js` / `test/chat-sessions.test.js` / `test/chat.test.js` / `test/panel.test.js` / `test/bridge.test.js` 钉住。

