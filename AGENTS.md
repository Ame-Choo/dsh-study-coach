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

要找「这个功能该动哪几个文件」，看 [`DEV.md`](DEV.md)：请求链路、数据落盘、加 API / 加工具 /
加面板子页面各要动哪几处、测试 harness、验收与发版都摊在那里面。这份 AGENTS.md 只写**不许怎么做**。

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

## 右下角那颗悬浮窗（`assets/panel.js` 的 `.float` / `.fab`）

- **展开和收起共用一份位置**（`ui.floatPos` ↔ `localStorage` 的 `study-coach:float-pos`）：收起成图标时
  **整颗 `.fab` 都是抓手**，拖到哪儿、点开就在哪儿，收起来又回同一处。找元素用 `floatBox()`
  （**分两次 `querySelector`**：`.float` → 没有才找 `.fab`；合成一个选择器会把测试里只认 `'.float'` 的
  `__query` 桩打空），别在别处再写一份。
- 拖完那一下**不算「点开」**：挪过 3px 才算拖（`moved`），`pointerup` 记 `floatNudged = fromFab && moved`，
  click 分支先吃掉它一次。少了这条，图标拖完手一松就弹窗。
- 复位两条路：窗子**双击标题栏**、图标**右键**（`contextmenu`，图标状态没地方双击）——都走 `resetFloatPos()`。
  `clampFloatToView()` 每次重画都按一遍（位置可能是在外接屏上拖的）。
- 图标是手画的 SVG 常量 `FAB_ICON`（右上切角对话方块 + 两行短规 + 左下小尾巴，`stroke: currentColor`），
  **不要退回 emoji**；`.fab` 自己带 `cursor: grab` / `touch-action: none`，`.fab.moved` 把 `right/bottom` 让开。
- 钉在 `test/panel.test.js`「浮窗能拖着走…」/「图标状态的浮标也能拖…」/「浮窗记的位置是另一块屏幕上拖的…」。

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
- **画布能拖着挪**（用户 m21561 把这条要回来了；中间有一版「不可动的」被否，别再照那版写）：
  `assets/graph.js` 末尾那节——`pointerdown` 记起点，`pointermove` **挪过 `PAN_SLOP = 4px`** 才
  `svg.classList.add('is-panning')` + `setPointerCapture`，之后 `state.view.tx/ty = 起点 + 位移 / scaleOf()`；
  `pointerup` / `pointercancel` 收干净，没算成拖就 `pointerleave` 清掉起点。三条硬规矩：
  ① **位移要除以 CSS 拉伸比**（`scaleOf()` = `min(w/vw, h/vh)`，跟滚轮缩放同一个换算），拿像素当 viewBox 单位拖快了就飘；
  ② **按在 `.kg-tools` 上的不算拖**（那是点按钮，`inTools()` 放行），HUD 挂在 `<svg>` 上、天生不跟着走；
  ③ 拖太远被 `PAN_MAX` 收住，`复位视图` 是后路。
  `assets/graph.css` 里 `.kg-svg { cursor: grab }`、`.kg-svg.is-panning, .kg-svg.is-panning * { cursor: grabbing }`。
- **拖过的那一下不算点**：`pressAt` + `watchDrag(svg)` 记按下位置，
  `draggedFromPress(event)` 只在 **同一个 `event.target`**、≤1500ms、位移 >4px 时返回 true；五个 click
  处理器（`.kg-btn` / `.kg-band-hit` / 模块大类 `g` / 单元 `g` / `.kg-tool`）开头 `if (draggedFromPress(event)) return`。
  写测试时 `pointerdown` 与 `click` 要派发在**同一个节点**上，不然按 `event.target` 比下来不成立；
  **展开一次会整幅重画（新 `svg`）**，拖拽用例里每一步都要从当前 DOM 重新取节点。
- **普通滚轮不缩放**：`svg` 的 `wheel` 头一句 `if (!event.ctrlKey && !event.metaKey) return`（也**不要**
  `preventDefault`，页面得照旧滚）；**Ctrl／⌘ + 滚轮**才缩放。`test/graph.test.js` 所有 `wheel` 派发都要带
  `ctrlKey: true`，另有一条钉「光滚轮不动画面、不 preventDefault」。`.kg-tool` 的
  `复位视图` / `全部收起` 与 Ctrl 滚轮、拖着画布是全部交互。
- **单元上那两颗按钮永远活着**（用户要求：「看课的话自动指向特定文件，做题的话就直接跳转 AI 教练让他布置」）：
  `assets/graph.js` 里就是 `for (const [kind, label] of [['video','看课'],['practice','做题']]) pill(label, '', () => onOpen(kind, point))`
  ——点下去要做什么由 `assets/panel.js` 的 `openMaterial(kind, point)` 分派，**别在这里判 `point.video` 有没有**
  （挂没挂只决定 `openLesson` 走哪条兜底路，按钮本身不灰）。`test/graph.test.js`
  「看课 / 做题两颗按钮一直在，没挂材料也是活的」钉着。
  · **看课** `openLesson(point)`：先 `GET /study/api/point/media?point=`（`lib/routes.js` 那条路由 →
    `videoForPoint()`），有 `hit.url` 就打开；`hit.kind === 'folder'` 或 why 不是「资料图谱里写着…」时补一条 toast
    （「这一部分里 N 个视频」，得让学生知道没落到单集）。旧服务端（`capabilities.media` 为假）才退回 `point.video`，
    再没有才发那句「这一节尚未关联网课」的 inbox。
  · **做题** `askCoachForWork(point)`：**不再跳做题页**，而是把四行请求（我想练哪个单元 / 先看掌握度该复习的错题 /
    从材料里挑具体那一段并说清为什么 / 用 `study_plan` 落一条今天的任务）POST 到 `/study/api/chat/send`，
    然后 `go('coach', '/study/coach')`。同一个单元只递一次（`FORWARDED` 的键 `'work|' + point.id`）；
    **发送失败要把那条键删掉**，否则重试一次都没了。
- **`videoForPoint()`（`lib/material-tree.js`）是这一节的核心，改它之前先读那几句注释**：三档评分
  （100 图谱里写着同一个 `pointId` / 80 key 完全相等 / 60 互相包含且短的 ≥5 字 / 40 最长公共子串 ≥6，
  20 模块名、10 大类名只算「这一部分」），`nameKey()` 去序号标点**和连词**（`与和及`——`基础知识与基本例题` 与
  `基础知识&基本例题` 要算同一件东西），同分比 `[score, aff, kindRank]`，`aff` 是 `coverOf()`（两字片段重叠）
  **只跟这一节的名字比**、不掺模块名。**只有 `score >= 60` 且不是文件夹才敢直接开文件**，其余一律 `partHit()`
  退成文件夹（里面正好一讲就展开）。踩过两回：`sharedRun >= 3` 太松（「题型1」人人有，10 个单元全指到同一个
  mp4）、父目录跟模块名同名互相加成会把长文件夹名抬高。真数据 67 个单元复核 = 42 个落到具体 mp4 / 25 个落到文件夹 / 0 个空手。
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
- **复盘图只在「今日任务」这一页**：`loadReview()` 的触发条件是 `page === 'today'`（一度是 `|| page === 'home'`，
  用户看过之后说「主页的今日任务和今日复盘删了吧」，收回来了——**主页是路口，活儿在各自那一页**）。
  它只要求 `svg` 是字符串（`data` 可以是 `null`），`reviewCard()` 因此有空态分支——**这一天什么都没动过
  也要出卡**，写清「怎么让它有内容」，但别放「下载 SVG」。
- **主页的 `.cards` 只有一张**：`fold('guide', '教练的指引', guideCard())`。别再往主页挂任务卡或复盘图
  （`test/panel.test.js` 那条「今日任务与复盘图都不在主页：主页只留路口，活儿在各自那一页」钉着：
  主页不许出现 `data-card="today"` / `data-card="review"` / `data-act="task-toggle"`，也不许去打 `/api/review?date=`）。
  `tasksCard()` 本身不依赖「当前页是 today」（`load()` 里 agenda 与 `/study/api/state` 不分页拉），
  所以哪天又要挂回去，功能上不会坏——但那是产品决定，别自作主张。
- `test/panel.test.js` 的 harness 用 `review` 选项喂图（`review: null` 才走得到空态分支）；
  断言别拿 `/api/review` 当条件——探活也会打这个路径，要写 `/api/review?date=`。

## 「能力」页并进了知识地图页（`assets/panel.js` 的 `.mastery` / `.pie-*`）

导航里**没有「能力」了**（用户要的）：那一页的两节落到知识地图页图谱下面，`PAGE_CARDS.map` =
main `[['map','知识地图',mapCard], ['ability','掌握度',abilityCard], ['mistakes','错题本',mistakesCard]]`、
aside 空着（用户后来把地图页那张画像删了：「地图页的删了」），所以这一页是**一栏到底**。

**学生画像只在档案页那一张**（见本节末与「档案」页那条），地图页不许再摆。老网址 `/study/ability` 靠 `resolvePage()` 的 `alias`
落到地图页，`PANEL_PAGES` 里**留着**它（老 URL 不能 404）——`test/pages-consistency.test.js` 钉着这条。

- **图谱卡里那份大类折叠列表只此一份**：`groupedBlocks(modules)` 现在只由 `abilityCard()` 调用
  （`mapCard()` 末尾不再铺一遍）。图谱卡下面是掌握度卡，两处别各画一套大类。
- **这张卡还挂在「档案」页**（用户说「掌握度在档案页面也要加一个」）：`PAGE_CARDS.library` 的 main =
  `[['who','学生档案',studentFileCard], ['library','学习档案',libraryCard], ['ability','掌握度',abilityCard], ['materials','材料',materialsCard]]`，
  跟地图页**同一张** `abilityCard()`、同一个展开 id `ability`（别复制一份改改，那会开始漂）。
  **边栏是 `[['goal','学习目标',goalCard], ['student','学生画像',studentCard], ['tools','基本工具',toolsCard]]`**——
  学生画像就摆在「学习目标」下面（用户 m21687 原话：「学生画像加到档案里，学习目标下面」；
  之后又说「地图页的删了」，所以**全仓只有这一张** `studentCard()`）。
  `test/panel.test.js` 的档案页那条钉着 `data-card="ability"` + `pie-slice` + 「整体掌握度」，
  以及边栏次序 `goal → student → tools`。
- **四层掌握度每一级都给一条**（用户原话：「掌握度模块针对每个大类、模块、最小单元都要给一个四层掌握度」）：
  `bandIndexOf(stage)`（`MASTERY_BANDS.findIndex`，认不出按「没接触过」）→ `bandCounts(points)`（`{counts, total}`）
  → `bandStrip(points)`（大类头、模块头那一条 72×6 的四段色带，`title` 写
  「熟练掌握 n · 大概掌握 n · 薄弱 n · 完全不会 n（共 N 个单元）」；`total` 为 0 就回空串，别画一条空的）
  → `bandCells(stage)`（单元那一行四格小灯，`[...MASTERY_BANDS].reverse()` 后前 `4 - idx` 格亮
  `<i class="on">`，**最左那格永远亮**，`style="--c:档色"`）。色带/灯只许用 `--stage-1…6`。
  挂点：`groupedBlocks()` 大类头、`moduleBlock()` 模块头、`pointRow()` 在 `.stage-tag` 之前。
  `bandStrip` 里**别用 `r2()`**——那是 `masteryPie()` 的局部函数（踩过，`r2 is not defined` 整张卡都渲染不出来）。
- **综合学生档案卡 `studentFileCard()`**（用户原话：「在档案界面增加一个学生档案（综合性的）」）：
  档案页最上面那一张，把散在各处的结论揉成一份——`.judgement`（`state.ability.judgement`）、`.stats`、
  `.who-bands`（四层色带 + 四档计数）、七天节奏、前 4 条 `state.student.facts`、基本工具 `state.profile.tools`、
  `mistakes.byStatus`，末尾写明「这套档案是教练每次看完作业、听完课更新出来的」。
  它是**只读汇总**，改数据仍走对话里的 `study_ability` / `study_student`——别再给这张卡加写接口。
- 饼图是**整体**四档分布：`MASTERY_BANDS`（熟练掌握 = 熟练稳定 + 能讲明白 → `--stage-6`；
  大概掌握 = 能独立做 → `--stage-4`；薄弱 = 能跟做 + 见过 → `--stage-2`；完全不会 = 没接触过 → `--stage-1`），
  `masteryBands(byStage, total)` 把认不出的差额并进最后一档，`masteryPie()` 用
  `pathLength="100"` + `stroke-dasharray="${pct+0.4} 100"` + `stroke-dashoffset="-acc"` 画在
  `<g transform="rotate(-90 100 100)">` 里（0% 那档写 `0 100`，否则兜底线段会留一截）。
  整体掌握度写三处：圆心 `<b>${pct}%</b>`、`aria-label`、图例下面的「一共 N 个单元：…」。
- 颜色只许用 `--stage-1…6` 那几个 token（浅色主题那套在 `html[data-theme="light"]` 里也有值），
  别写死色值。大类行的版式沿用 `.group-head`（caret + 名字 + 量尺 + 百分比 + `档案`），
  只是 `档案` 按键落在行尾——用户说「就在大类名字旁边」，行尾那一串同属那一行，别再新起一套。

## 「学习」页 = 资料图谱（`assets/panel.js` 的 `.atlas-*`）

**这一页按「材料自己的目录」摊三层：大类 → 模块 → 最小单元，每一层右边都挂着能直接打开对应那一段的链接**
（用户原话：「资料图谱推倒重做吧，按照资料的目录或者文件夹分类来做三层：大类、模块、最小单元，
以及对应链接来」）。骨架在服务端算，面板不自己拼（上一版是客户端拿知识图谱拼的，已作废）。

- 服务端：`lib/material-tree.js`（入口 `materialTree({ material, shelf, spans, list, tree })`）+
  `GET /study/api/material/tree?materialId=` → `{ ok, material, basis, truncated, groups, loose }`。
  `basis` 四选一：**`agent`（教练用 `study_analysis` 的 `tree` 写下来的，最优先）**、`toc`（书按目录摊）、
  `spans`（目录没读过，就一段一段的页级索引自己当单元）、`folder`（path 是文件夹的，按子目录当模块、
  文件名当单元）。**这是 `lib/` 改动 → 要重启 DSH**，旧服务端上这一页会走「去重启」那张卡。
- **书那棵树只信目录，不许拿 spans 硬凑一层**（踩过，用户一句「完全是乱的啊，逻辑有问题吧」推倒重来）：
  分析里的 spans 常是**整专题一条**，旧写法把「和模块页范围有交叠的 span」当单元，于是同一句话被抄进
  该专题每个模块、单元 id 跟模块名对不上（真数据里 `1.2 常用逻辑用语` 那行写着 `M1.1`）。现在：
  大类 = level 1、模块 = level 2、最小单元 = level 3；**目录没有第三级就不许再造一层**，`module.leaf === true`，
  模块自己就是最小单元、链接直接挂模块头。`spans` 只在「目录压根没读过」时当兜底。
- **给 agent 的接口就是 `study_analysis` 的 `tree`**（用户问「是不是也要给 agent 一个接口然后让 agent
  根据 prompt 做比较好」，答：是）：形状大类 → 模块 → 最小单元（单元层可省）。`lib/analysis.js` 的
  `treeOf()` 只认形状，`upsertAnalysis` 里是**整份覆盖**（传了就换、不传不动、`tree: []` 清掉），
  `materialTree()` 有它就优先。面板 `srcHint`：`basis === 'agent'` 写「这三层是教练读过之后写下来的」，
  否则写「按它自己的目录自动摊的——教练读过一遍再写下来会更准」+ 一颗「让教练核一遍」（`data-act="atlas-annotate"`）。
  agent 那半的用法写在 `skills/study-coach/SKILL.md` 的「顺手写「资料图谱」」那一节。
- 面板：`loadAtlas()`（`atlasTree` 只在这一页拉一次）、`atlasCard()`、`atlasUnitRow()`、`atlasLinks()`、
  `linkLabel()`、`firstClause()`。**一次只挑一份材料**（`ui.atlasPick`），那排筹码就是切换器；
  折起来的大类/模块记在 `ui.atlasShut`（键 `g:大类序号` / `m:大类序号:模块序号`），纯客户端不打服务端。

- **新加一个面板子页面要记账**：`lib/handler.js` 的 `PANEL_PAGES`（`:27`）里得添上那段路径名，
  否则那个网址直接 404（它只认列出来的那几个）。这是 `lib/` 改动 → 要重启 DSH。
  **并掉一个页面则反过来**：从 `assets/panel.js` 的 `PAGES` 里删掉、`PANEL_PAGES` 里留着（老 URL 不能 404）、
  在 `resolvePage()` 的 `alias` 表里指到活着的页上，并在 `test/pages-consistency.test.js` 的 `LEGACY_PAGES` 里写清为什么留着。
- 抬头复用今日任务那套 `.day-hero`（眉标 `MATERIAL GRAPH · 资料图谱`、`.day-pill` 写「N 份材料 ·
  这一份 N 条内容」、`.day-gauge` 的 `aria-label="已挂到单元 P%"`）——**复盘图那套版式是这一族的唯一版式**。
- 版本守卫：`probeCapabilities()` 里 `alive('/study/api/material/tree')`（缺参新代码回 400、旧代码 404）
  → `capabilities.tree`。没有它就别说「还没标」，直接告诉学生**去重启 DSH**——这一页是 `lib/` 那一半。
- 三级 DOM：`.atlas-group`（`data-act="atlas-shut"` 的 `.atlas-group-head` + 转动的 `.atlas-caret` +
  `.atlas-gname` + `.atlas-range`）→ `.atlas-mod`（同款头 + `.atlas-mtitle` + `.atlas-mid`）→
  `ul.atlas-units > li.atlas-unit`（`.atlas-label` 里 `.atlas-id` 写**名字**、`.atlas-name` 是
  `firstClause(note)` 两行 clamp；`.atlas-meta` 里 `.atlas-kind` 类型 + **`.atlas-kind.atlas-point` 筹码**
  （`u.pointId && u.pointId !== u.title` 时才出——名字和 id 是两件事）+ `.atlas-range` 页码 + `.atlas-links`）。
  **`module.leaf` 的模块头不带 caret、不给 `data-act`**（点了没东西可折）、计数写「最小单元」、
  `atlasLinks(m)` 直接挂模块头。来源那行是 `.atlas-src`（`srcHint`：`basis === 'agent'` 与自动摊两套文案）。
  `atlasUnits()` 要把 leaf 模块也算成一条内容，否则「N 条内容」少一截。
  **`.atlas-meta` 的 `max-width` 只能写 `100%`**：写 `62%` 时它在 `auto` 轨道里按自身 max-content 打折，
  一行里塞三件（类型 / 页码 / 链接）就折成两行，一屏 494 条内容全变高的（踩过，样张上看出来的）。
  **材料一律写全名，不许退回 A/B/C**（用户原话：「教辅的名字要显示它的名字而不是一串字母」）。
- `linkLabel(u)` **按扩展名说话**：`.pdf` → 打开 PDF、`.mp4|m4v|mov|mkv|flv|avi|wmv` → 打开视频、
  `.md|markdown|txt` → 打开正文、`u.kind === 'folder'` → 打开文件夹、其余 → 打开。
  判扩展名**只许切 `#`，别切 `?`**——`String(u.url).split('#')[0]`；写成 `split(/[?#]/)` 会把 query 一起切掉，
  `/study/file?path=…pdf` 里的 `.pdf` 就看不见了（踩过）。链接走 `assets/urls.js` 的 `openPath()`，别自己拼。
- `tree.loose`（封面、目录、答案这些没归到任何模块的页）单开一块「没归到目录里的」，
  **标题退回内容类型**（`moduleTitle` 传 `''`，别写「其余」）；一条 pointId 都没有的那几份收进 `.atlas-blank`
  （「这份材料还没挂到最小单元上」）+ 一颗「交给教练去标」。
- **一行内容只有「类型 + 页码 + 链接」，没有别的按钮**（用户原话：「今日任务的打开 / 看这节网课 /
  这一节的讲义 / 做题 / 看掌握度 / 改 / 删除 这几个功能只需要留下打开 改 删除就可以了」；
  「看完了那个功能也不太必要，删了吧，然后让教练在每次布置任务的时候看看学生档案就行了」）。
  · 「看完了」那一整套**已经删掉，别再捡回来**：账本 `watched.json`、`lib/watched.js`、
    `POST /study/api/watched`、面板 `watchKeyOf` / `watchMarkOf` / `watchable` / `watchCell`、
    `.watch-btn` / `.is-watched` 全没了。**判断「他有没有在学」只看两份档案**
    （掌握度档案 + 总体评价），入口仍是对话里的 `study_record` / `study_ability`。
  · **今日任务那一行的按钮只有「打开」+ 行尾的「改 / 删除」**：`taskView()`（面板）与 `taskLinks()`
    （`lib/map.js`，工具那半吃同一份）只给**一颗** `打开`，挑法是 `task.open` → 单元 `video` → 单元
    `practice`（都没有就不给按钮）。旧的「观看本节网课 / 本节讲义 / 看完后做题 / 做题 / 查看掌握度」
    **不许加回来**——要练哪个单元，走知识地图那颗「做题」，让教练按学生档案挑材料页码与题号。
- **转给教练只有一个出口**：`forwardToCoach({materialId, title, path, reason, annotate})`。
  `annotate: false` 是「读不动」的措辞，`true` 是「没标到单元上」的措辞——两套话都写在那一个函数里，
  别在其它地方再拼一遍。**同一份 + 同一个理由只投一次**（`acted` 表），否则刷新会刷出一串重复消息。
- 对话滚动：`paintChat()` 自己负责「换 DOM 前后把 `scrollTop` 放回去」（贴底时要落底），
  **别指望浏览器换 `innerHTML` 时替你保住位置**——这就是「发一条就跳回顶部」的根。
  换会话（不是刷新）强制落到底。`test/panel.test.js` 的『对话：换会话落到底…』钉着这条。





