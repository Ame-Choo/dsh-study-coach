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

## 对话页的两条通道（表情包 / 广播）

- **表情包不走 DSH 的 origin。** `dsh-meme` 把图挂在 `/dsh-memes*` 上，可那是 DSH 自己的端口；
  面板那两个 origin 上这些路径一律 404，而 `webServer` 服务**没有** `port` 属性、也代理不了——
  所以直接读盘上的图库：`lib/memes.js`（`node:sqlite` 只读打开每个包的 `index.db`，
  `createRequire` 懒加载）。判据只在那一份里，别在路由里重写；**只读**，别往图库里写。
  找不到就 404，让面板退回那句描述文字（`<img>` 的 `alt` 就是它，不会留破图）。
- **广播通道也只有一份**：`lib/events.js` + `GET /study/api/events`（SSE）。没有订阅者不许跑定时器、
  `close` / `error` 必须退订（否则长连接挂在进程里）、定时器 `unref()`。写操作想立刻刷面板就
  `events.publish('chat')`。路由是被 `handler` 当 `{ handled: true }` 放过去的，别在它后面再写 JSON。
- 面板侧：`chatText()` 是唯一把 `[表情: …]` 变成图的地方；推送那一帧**在后台也照刷**，
  而轮询定时器**只在前台挂**——后台浏览器会节流（挂上纯属空转），而且活动的 interval 会让
  `node --test` 卡着不退出（`test/panel.test.js` 里那些 `hidden: true` 就是为这条）。
- 图片字节由 `lib/handler.js` 的 `sendRaw(res, raw)` 发：路由回 `{ code, raw: { type, body, cache } }`。

## 正文一律走 `assets/md.js`（markdown + 数学）

- **全仓只此一份渲染器**：读卷页、做题页、面板都用它，别再写第二份，也别引 marked
  （`assets/vendor/marked/` 已经被删掉了）。调用方要自己那套记号就给 `extras`。
- `inline()` 的次序是**安全边界**：① 抠代码段 → ② 抠数学 → ③ `extras` → ④ `escapeHtml` →
  ⑤ 链接 → ⑥ 粗/斜/删除线 → ⑦ 回填 `\u0000N\u0000` 插槽。**转义不许提前**（提前了 `\frac` 就废了），
  `extras` 的产物也不再过转义 —— 它自己负责转义（面板的 `MEME_EXTRA` 里就用 `esc()`）。
- 数学只有一条路：`renderMath(tex, display)`。KaTeX 不在场（或排不出来）就退回
  `<code class="md-math">` 源码，**绝不把 `$` 原样吐给用户**。`throwOnError: false` 会用它自带的
  内联红标错，`.katex-error` 那一条才需要 `!important`。
- **反斜杠是雷区**：真实消息里 Windows 路径是常态（`C:\Users\zongy\.dsh\…`），markdown 的
  转义规则会把 `\.` 吃掉 —— 所以抠数学必须赶在转义之前，别再加一条会动 `\` 的规则。
- 加一种新写法，`startsBlock()` 与 `renderMarkdown()` 主循环**两处都要改**（判据不一致会死循环）。
- 样式：气泡里的块级样式（`.chat-text .md-*`）收在 `assets/style.css`，标题在气泡里不放大；
  `.md-math` / `.md-block-math` / `.katex` 是三个页面共用的，也放 `style.css` 而不是各页的 css 里。
  动 `assets/*.css` 之前先读 `design.md`（这条在最上面）。
- 三个页面外壳（`panel.html` / `read.html` / `practice.html`）各自挂一次 katex 的 `<link>` 与
  `<script>`（UMD → `window.katex`，随包发在 `assets/vendor/katex/`）。装不上不致命，只是公式退回源码。

## 知识图谱是「关卡面」那版（`assets/graph.js` + `assets/graph.css`）

- **一屏只许三处信号青**：选中、进度、当前动作。其余一律 `--line` / `--dim` / `--faint`。
  圆角 0、零模糊硬偏移；这套语言跟 `lib/review.js` 那张复盘图是一家（那边是静态版，这边是可交互版）。
- **加装饰要另起 class**。`test/graph.test.js` 按数量断言：`.kg-box` 必须**正好等于大类数**、
  `.kg-halo` 全图 ≤ 1、`.kg-dot` 按可见单元数（菱形档位点）——底板、图例、刻线都别复用它们
  （`.kg-band` / `.kg-rail` / `.kg-tick` / `.kg-ord` / `.kg-gauge` / `.kg-mark` / `.kg-corner` 是这一类）。
- **HUD 不许补变换**：索引板 `.kg-plate`、工具箱 `.kg-tools`、提示句 `.kg-hint` 都**直接挂在 `<svg>`
  上**、跟视图层 `.kg-view` 平级，所以天生不吃 `translate(t) scale(k)`，拖动画布时钉在视口上。
  曾经以为要反向补 `translate(-t/k) scale(1/k)`——补了它们反而跟着鼠标乱飞（用户报的 bug）。
  `test/graph.test.js` 钉住「HUD 的 `transform` 是空、`parentNode` 就是 `<svg>`」。
  画序：网格 → `.kg-view`（板块/连线/单元）→ HUD，所以 HUD 永远压在最上面。
- **栏位宽度是定死的**（`STAGE_X` / `DUE_X` / `BTN_X`）：单元行里的按钮、行槽、行标一律 `x + 常量` 起排。
  写绝对坐标会让它们整片跑到模块列去（踩过一次，样张上才看出来）。
- **连线的基线要算对父节点那一截**：子节点的绝对 y 是 `baseY + node.y - node.subH / 2 + node.top + kid.y`
  （`node.y` 是绝对中心）。少这一截，线头就指到空白处——`test/graph.test.js` 有一条
  「每一条连线都落在子节点的中心线上」专门盯它。
- **像素↔viewBox 不许按 1:1 算**：滚轮缩放先把指针换算回画布
  （`scale = Math.min(box.width / vw, box.height / vh)`），再加 `preserveAspectRatio="xMinYMin meet"`。
  漏了这步，缩放就会「把东西带乱飘」——测试「滚轮缩放钉在指针底下」盯着（换算助手要拆 `atX` / `atY`，
  一个函数管两轴必错）。
- **画布不跟鼠标拖**（用户要求关掉）：`assets/graph.js` 里**没有**平移那套 pointer 监听，也别加回去；
  `.kg-band-hit` 的 click 因此不需要 `panned` 让路（那个状态已经删了）。滚轮缩放 + `.kg-tool` 的
  `复位视图` / `全部收起` 是全部交互，`test/graph.test.js` 用「按下再挪，`viewTransform` 一动不动」钉着。
  `assets/graph.css` 里 `.kg-svg` 的 `cursor: default` 别再改回 `grab`，也别加 `touch-action: none`。
- 折叠着也得报得出「N 个模块 / N 节」→ 用 `node.children.length`，不是这次画出来的子数。
- 连线是**正交折线**（`M 右沿 y H 中缝 V ky H 左沿`），布局是确定性递归，没有力导向、没有动画循环
  —— 所以它好测，别往里加 requestAnimationFrame。
- 视觉验收别拿正在跑的 DSH 折腾：离线样张 `F:\dshworkingspace(studyplugin\.graphcheck.html` +
  `.graphcheck-server.mjs`（19392），asset 全走 `process.cwd()`（手写绝对路径容易踩工作区那个括号）。

## 今日任务页与今日复盘图是一家（`assets/panel.js` 的 `.day-*` / `.day-hero`）

复盘图的版式（`lib/review.js`：眉标 + 大字标题 + `日期 · 周X` + 右上状态药丸 + 一条量尺 + 行首信号条）
现在也是**今日任务页抬头**的版式，改这一页时别另起一套：

- 卡片类是 `card day`（不是只有 `card`），抬头整块是 `.day-hero`：`.eyebrow` 写 `TODAY · 今日任务`、
  `.day-title` 用 `var(--fs-hero)`、`.day-pill` 是方角状态块（**不是胶囊**）、`.day-sub` 写 `日期 · 周X`、
  `.day-gauge` 是 7px 方角量尺（`role="img"` + `aria-label="今日完成度 P%"`；超预算转 `--warn`）。
- **周几自己算**（`WEEKDAYS` + `weekdayOf(date)`）。别 `new Date('2026-10-01')`——那是 UTC 解析，东八区差一天。
- 任务行是 `li.task-item` 三栏网格，第一栏两位序号 `.task-ord`（全页连续，不是每门课重来），
  左侧 2px 信号条**只给第一条没做完的** `is-next` 上 `--accent`——一屏一条青的账要继续算。
  侧栏模式有单独的 `grid-template-areas`，改网格记得两边一起改。
- **复盘图常驻主页与今日任务两页**：`loadReview()` 的触发条件是 `page === 'today' || page === 'home'`；
  它只要求 `svg` 是字符串（`data` 可以是 `null`），`reviewCard()` 因此有空态分支——**这一天什么都没动过
  也要出卡**，写清「怎么让它有内容」，但别放「下载 SVG」。
- **今日任务卡也常驻主页**（用户后来要的）：`homePage()` 的 `.cards` 依次是 `today` / `review` / `guide`。
  `tasksCard()` 不依赖「当前页是 today」——`load()` 里 agenda 与 `/study/api/state` 本来就不分页拉，
  勾选走文档级 `change` 委托，所以在主页上照样勾得动。断言「主页不是操作台」那条因此改口：
  `data-act="task-toggle"` 在主页是**该在**的，档案弹层与目标库表单仍不该铺在主页。
- `test/panel.test.js` 的 harness 用 `review` 选项喂图（`review: null` 才走得到空态分支）；
  断言别拿 `/api/review` 当条件——探活也会打这个路径，要写 `/api/review?date=`。




