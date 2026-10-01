# dsh-study-coach 开发手册

写这份手册的出发点：**下一个开这个仓库的人，大概率是个 agent。** 所以它不写「这个项目多有意思」，
只写「东西在哪、请求怎么走、要加一个功能该动哪几处、改完怎么验」。

## 0. 先认路：跟另外四份文档的分工

| 文档 | 什么时候翻它 |
| --- | --- |
| [`README.md`](README.md) | 想知道它现在长什么样、以前踩过哪些坑。它是一份**按时间追加**的叙述，末尾一堆「补：…」节就是历次改动的账本 |
| [`AGENTS.md`](AGENTS.md) | 动手之前必须过的硬规矩：常量不许在别处重抄、图标不许退回 emoji、新页面必须在 `PANEL_PAGES` 登记、别为前端小事新增服务端路由…… |
| [`design.md`](design.md) | 写 CSS、开新页面之前。配色 / 字号 / 间距 / 造型动机，色值一律抄 `assets/style.css` 顶部 `:root` |
| [`skills/study-coach/SKILL.md`](skills/study-coach/SKILL.md) | 改「agent 怎么教」的时候。它是方法论本体，483 行，按需加载 |
| 本手册 | 找文件、加功能、跑验证、发版。**它是地图，不是规范** |

## 1. 一句话架构：插件是两半

这个包同时交付两样东西，缺一样都不成立：

1. **代码那一半**——给 DSH 宿主和浏览器跑的：
   - `index.js`：host 半边入口，注册 `/study` 路由前缀、独立端口、21 个工具、学习教练预设。
   - `lib/`：服务端。HTTP 层（`handler.js` / `routes.js`）、领域层（`map.js` / `memory.js` / `student.js` / `toolbox.js` / `review.js` / `analysis.js` / `material-tree.js`）、落盘层（`store.js` / `schema.js` / `paths.js` / `library.js`）、外挂集成（`bridge.js` / `chat.js` / `preset.js` / `memes.js` / `events.js` / `pages.js`）。
   - `assets/`：面板前端。`panel.js` 一个文件就是全部界面，`style.css` 是唯一视觉事实来源，`graph.js` 是知识图谱那份 SVG，`md.js` 是唯一的正文渲染器。
2. **agent 那一半**——给对话里的模型读的，三层，别记混：
   - **persona**（`lib/preset.js` 的 `PERSONA_PREFIX`）：每一轮都占上下文，只写「最小交代」。
   - **SKILL.md**（随包 `skills/study-coach/SKILL.md`）：进这个模式后按需加载，全部方法论在这。
   - **工具**（`lib/tools.js`）：名字 + 描述 + schema + execute，21 个，是 agent 唯一能碰数据的通道。

判断该写哪一层，只看一句话：**「每轮都得知道吗」→ persona；「做事的方法」→ SKILL.md；「机器要校验的形状」→ 工具 schema。**

## 2. 五分钟上手

```bash
npm test                 # node --test，全量（不要写 node --test test/，会挂）
npm run preview          # 不起 DSH，把面板直接跑在 19390，用真数据
npm run check            # node scripts/check-live.mjs，探正在跑的 19387/19388 是新代码还是旧代码
npm run setup-repo       # 给仓库补 GitHub 远端那些东西（发版前用）
```

改完代码**什么时候生效**，是这个仓库最容易踩的坑：

| 改了什么 | 怎么生效 |
| --- | --- |
| `assets/*`（面板 js/css/html） | **刷新页面**就行——每次请求现读磁盘 |
| `lib/client.js`（设置页那段浏览器脚本） | 刷新设置页 |
| 其它 `lib/*`、`index.js`、`package.json` | **必须重启 DSH**。热重载、禁用再启用、改 `cordis.patch.yml` 都换不掉已加载的模块 |
| `skills/**`、`README` 等文档 | 下一次加载时读，无需重启 |

没重启时的典型症状：页面看着是新的，一点按钮全 404，响应体是
`{"ok":false,"error":{"code":"not-found","message":"unknown study route"}}`。
面板自己会防这一手：开机探一遍新路由，缺了就顶上挂一张体检卡（`probeCapabilities()` / `healthReport()` / `healthCard()`，分「挡路的 / 该修的 / 顺手能做的」三档）。

## 3. 仓库地图

```
index.js                    host 入口：apply(ctx) 里把下面这些东西装起来
cordis.patch.yml            只放一行 insert（插件声明）。**别把预设写这儿**，包名解析不到会让 loader 直接爆
lib/
  handler.js   HTTP 层最外层：页面 / 静态资源 / 文件出口 / 上传落盘，再交给 router
  routes.js    API 路由表：52 条正则，按注册顺序匹配
  tools.js     21 个 study_* 工具（buildTools 出 spec，registerTools 补 schema 再注册）
  preset.js    学习教练预设：persona + skill-filesystem 指向包内 skills/
  session-preset.js  「这个会话是不是学习模式」的唯一切判处
  store.js     档案读写（整份读-改-整份写，tmp + rename）
  schema.js    常量与空档案工厂（STAGES / FILES / emptyProfile()…）零依赖
  paths.js     目录算法只此一处（数据根 / pages / uploads）
  library.js   多档案库：名册、切换、软删、回收站
  map.js       地图 + 掌握度 + 错题 + 每级档案 + 总体能力 + 任务视图（纯函数）
  analysis.js  材料分析 + 页级索引（spans / pagesForPoint）+ 教练写的资料图谱 `tree`（`treeOf()` / `upsertAnalysis` 整份覆盖）
  material-tree.js  资料图谱的三层骨架：优先用教练写的 tree，否则按材料的目录/文件夹摊（basis: agent / toc / spans / folder）
  memory.js    记忆卡与艾宾浩斯排期
  student.js   学生画像（结论层，每条必须挂证据）
  toolbox.js   番茄钟 + 清单
  review.js    今日复盘图：服务端直接拼 SVG
  pages.js     PDF 拆页 / 读书签（Python + pymupdf）
  build-pages.mjs  拆书子进程脚本（detached 跑，主进程只看 manifest）
  settings.js  面板独立端口的配置（settings.json，与学习档案无关）
  notice.js    面板顶上的指引 + 面板留言
  bridge.js    面板 → 对话（sessionController.prompt）
  chat.js      对话 → 面板（list + follow 取第一帧）
  memes.js     只读表情包图库（node:sqlite，懒加载）
  events.js    SSE 广播通道（/study/api/events）
  panel-server.js  独立端口那半边（19388）
  urls.js      一行 re-export，把 assets/urls.js 的门牌规则给宿主共用
  client.js    设置页「学习教练」那段浏览器脚本（唯一会被现读的 lib 文件）
assets/
  panel.js     整个面板界面（单文件，字符串拼 HTML）
  style.css    视觉唯一事实来源（:root 变量表 + 末尾「方舟层」）
  panel.html / read.html / practice.html   三个静态壳
  graph.js graph.css   知识图谱
  md.js        唯一的 markdown + KaTeX 渲染器（面板 / 阅读页 / 做题页共用）
  practice.js read.js boot.js stages.js urls.js katex vendor…
skills/study-coach/SKILL.md    agent 的工作法
test/                          39 个测试文件，node --test
scripts/                       check-live.mjs / preview.mjs / setup-repo.mjs
design.md  README.md  AGENTS.md  PUBLISHING.md
```

## 4. 一个请求怎么走

`ctx.webServer.register({ kind:'prefix', path:'/study', handler })`（`index.js:161`）把 `/study` 开头的请求全交给 `handler(req, res)`（`lib/handler.js:343`），分支顺序是：

1. `isPanelPath(pathname)` → `assets/panel.html`（认 `/study`、`/study/`，以及 `PANEL_PAGES` 里那八个：`today / map / ability / library / coach / materials / toolbox / atlas`，`lib/handler.js:27`）。
2. `/study/practice` → `practice.html`；`/study/read` → `read.html`。
3. `/study/assets/*` → `resolveAsset`，normalize 之后必须仍在 `assetsDir` 里，否则 404（防穿越）。
4. `/study/file?path=` → `allowedTarget`，只放行学生已登记材料所在的那几棵子树；目录列成页，文件走 `sendStream`（支持 Range → 206/416）。
5. `/study/page?path=` → 只放行 pagesRoot 下存在的页图。
6. `/study/api/doc` → 白名单扩展名 + 只读头部 ≤512KB。
7. `POST /study/api/material/upload` → 边收边写盘（≤300MB），再把 `{savedPath,name,size,dir}` 当 body 交给 router。
8. 其余：`readBody`（默认 2MB）→ `await router({ method, pathname, query, body, req, res })`。

router 的出口只有三种（`lib/handler.js:507` 一带）：

- `{ handled: true }` → 直接返回，**后面不许再写 JSON**（SSE 的 `/study/api/events` 自己接管响应）。
- `{ raw: { type, body, cache } }` → 发字节（表情包走这条，`cache-control: public, max-age=86400`）。
- 其它 → `sendJson`，一律 `cache-control: no-store`。

`routes.js` 里 `handle` 先把 `HEAD` 当 `GET`（`:1468`），按序跑 52 条正则；命中后调 `fn({ body, query, params, req, res })`；校验失败统一 `bad(message)` → 400 `{ok:false,error:{code:'bad-request',message}}`；全不中 → 404 `unknown study route`；漏出来的异常在最外层变 500（`internal`）。

## 5. 数据落在哪、长什么样

**仓库里没有一条学习内容。** 全在数据根，默认 `~/.dsh/study-coach/`，环境变量 `DSH_STUDY_ROOT` 优先（只 `lib/paths.js:31` 一处读它）：

```
<root>/settings.json           面板独立端口 / 自启（与学习档案无关）
<root>/registry.json           有哪几个学习目标、现在用哪个
<root>/profiles/<id>/profile.json   goal / materials / tools / ability
<root>/profiles/<id>/map.json       大类 → 模块 → 最小单元
<root>/profiles/<id>/mastery.json   每个知识点的档位、证据、错题、复习时间
<root>/profiles/<id>/tasks.json     按日期分的任务
<root>/profiles/<id>/analysis.json  每份材料通读后的结论 + 页级索引（`tree` 是教练写的那份三层图谱）
<root>/profiles/<id>/toolbox.json   番茄钟 + 清单
<root>/profiles/<id>/memory.json    记忆卡与排期
<root>/profiles/<id>/student.json   学生画像
<root>/profiles/<id>/guide.json     面板顶上一句话
<root>/profiles/<id>/inbox.json     学生在面板上留的话
<root>/pages/                  拆出来的页图 p%04d.png + manifest.json
<root>/uploads/                网页上传的原件
<root>/trash/<id>-<ts36>/      软删的整份档案
```

写盘规矩：`Store.write` 先写 `.tmp` 再 `renameSync`（`lib/store.js:90`），所以任何时刻盘上都是一份完整 JSON；
`update` 是**整份读-改-整份写**，除 map/mastery 外自动补 `updatedAt`。**没有文件锁**——同一进程靠 Node 单线程串行，
跨进程只有拆图子进程，而它只写自己那本页图目录。读的时候 JSON 坏了退默认值，不崩。

多科目：`registry.json` 只记名册与 `active`，`Library` 给每个 profile 记忆化一个 `Store`，
`read/write/update` 全转发给 `activeStore()`（`lib/library.js:409`），所以「切档案」只是改一个字段，
路由和工具都不必知道手里拿的是 `Store` 还是 `Library`。删是软删，最后一个档案不许删。

## 6. agent 那一半怎么写

### 6.1 三层各自的边界

- **persona**（`lib/preset.js` 的 `PERSONA_PREFIX`）：最小交代——进这个模式先加载 skill、每次开口先 `study_report`、
  面板不是只读但数据归谁写、地图草稿要学生认可才能 confirm、掌握度只有 quiz/photo 能推档、排计划卡 `minutesPerDay`、口吻。
  往这儿加内容之前先问一句「这该放 SKILL.md 还是放这儿」——**persona 每轮都占上下文**。
- **SKILL.md**：工作法本体（第 0～12 节：开场、问目标、收材料、画地图、摸底、六档、排任务、收作业、复盘、面板档案、不许做的、出错怎么办、规范没细说按这里办）。
- **工具**：只装「什么时候调 / 参数怎么填 / 返回看哪个字段」，以及机器能校验的形状。

### 6.2 工具是怎么注册的

`lib/tools.js:551` 的 `buildTools(store, opts)` 返回 **21 个 spec 对象**（`name / description / parameters / output:{schema,render} / execute`），
没有单独的 describe 步骤；`registerTools`（`:2680`）用 `sealSchema()` 递归给每个 object 节点补 `additionalProperties:false`
（宿主 schema 编译器漏一个就抛 `UNSUPPORTED_SCHEMA`），再逐个 `ctx.tools.register(defineTool(spec))`。
返回的是 `ctx.tools.register` 的返回值数组，`index.js:187` 逐个 try/catch dispose。

写 schema 的两条宿主规矩（踩过）：

- `required` 要么不写、要么 `true`。写 `false` 会抛 `parameters.X.required must be true when present`，
  所以「条件必填」只能靠描述 + `execute` 里的中文报错（例：`study_map` 只在 `action=set` 时必填 `modules`）。
- 每个 object 节点都要显式 `additionalProperties`；写 `false` 就得把字段列全，
  所以返回给模型的对象一律走 `pickTask` / `pickModule` 这类投影函数裁字段。

### 6.3 加一个工具，最少动这几处

1. `lib/tools.js`：加一个 spec（照最全的样板 `study_record`，`:819-940`）。
2. `index.js:17-26` 的注释里那份 **21 个工具清单**同步（注释是给人看的账本，`buildTools` 的返回数组才是事实）。
3. `test/tools.test.js`：结构断言自动覆盖，但**行为测试要手动补**——至少一条成功的、一条被拒的，并断言「被拒不落盘」。
4. 若写了新的档案 key：在 `lib/schema.js` 的 `FILES` / `emptyProfile()` 与 `Store.default()` 里加上，再补一条落盘-重读测试。
5. 若它读 `opts.pagesRoot`：测试 harness 要从 `{ panelPath }` 换成补 `pagesRoot`。
6. 若它进了 persona 提到的流程：SKILL.md 对应节也要写一句。

### 6.4 硬闸门（升档）只有一份实现

`lib/map.js:29` 的 `gateStage(mastery, pointId, wanted, kind)` 是唯一那道门：
一次只推一档（跳档压回上一档），往「能独立做 / 熟练稳定 / 能讲明白」推时必须先有够数的
`quiz` / `photo` 证据（`STAGE_NEEDS = { 能独立做:1, 熟练稳定:2, 能讲明白:3 }`、`WORK_KINDS = ['quiz','photo']` 在 `lib/schema.js`）。
**agent 的工具和学生自己在面板上点的那颗档位按钮走同一条门**（`POST /study/api/mastery`）；
`test/mirrors.test.js` 钉住这两条常量不许在别处重抄。

## 7. 服务端怎么加东西

### 7.1 加一条 API

1. **先在领域层写纯函数**（`lib/map.js` / `memory.js` / `student.js` / `toolbox.js` / `analysis.js`）。
   这些文件**不碰盘、不读时钟**——时间一律从参数进来（`now = new Date()`），随机数、文件系统也都在调用方。
   这条守住了，测试才好写。
2. **在 `lib/routes.js` 注册**：`on('POST', /^\/study\/api\/xxx$/, fn)`，`fn` 拿 `{ body, query, params, req, res }`。
   校验失败就 `bad('中文说清哪一项不对')`（→ 400）；成功回 `{ code: 200, body }`；发字节回 `{ raw: {...} }`；自己接管响应回 `{ handled: true }`。
3. **面板调它**：`assets/panel.js` 的 `api(path, body)` 会 `res.json()` 并在 `ok === false` 时抛 `error.message`
   ——所以服务端那句中文报错就是用户看到的 toast 文案，写清楚点。
4. **补测试**：路由 / 领域级的落在对应的那份测试里（`test/tasks.test.js`、`test/shelf.test.js`、`test/mistakes.test.js`、`test/ask.test.js`、`test/review.test.js`……），
   面板级的进 `test/panel.test.js`。

几条写路由的既定口味：落盘发生在**投递之前**（「存下来是底线，投进对话才算真的递到了」，投递失败不回滚）；
带 `profileId` 的接口先用 `storeFor()` 查名册再取档案，因为 **`Library.store()` 对没见过的 id 会顺手造一份空档案**；
返回值里给面板的东西都裁过字段（别把整份 state 丢出去）。

### 7.2 加一个面板子页面

四处，缺一处就出问题：

1. `assets/panel.js` 的 `PAGES`（`:811`）加一条 `{ id, path, label, hint }`（导航靠它）。
2. 同文件 `PAGE_CARDS`（`:871`）给这一页配 `main` / `aside` 卡片。
3. `lib/handler.js:27` 的 `PANEL_PAGES` 加路径名——**不加就是 404**，而且这属于「要重启 DSH」的那一档。
4. `test/pages-consistency.test.js` 会检查：`PAGES` 里每一项都必须在 `PANEL_PAGES` 里；
   `PANEL_PAGES` 多出来的必须正好等于 `LEGACY_PAGES` 里写明的老地址；`resolvePage()` 的 `alias` 表要指到活着的页。

**并掉一个页面**（我们真干过，把「能力」并进知识地图）走的是反向流程：从 `PAGES` 删、`PANEL_PAGES` **留着**（老 URL 不能 404）、
`resolvePage()` 的 `alias` 指向活着的页、`LEGACY_PAGES` 写清「为什么留着它」。

### 7.3 加一个档案字段 / 一张表

新 key 要同时进 `lib/schema.js` 的 `FILES`、`emptyProfile()` 与 `Store.default()`（`Store.default` 遇未知 key 抛 `unknown file: <key>`）。
落盘一律走 `store.update(key, fn)`（读-改-整份写，tmp + rename，自动补 `updatedAt`）。写完补一条「落盘 → 重读 → 断言」的测试。

## 8. 前端怎么写

`assets/panel.js` 是一个 4285 行的单文件，结构就三段：

- **`ui`（`:93`）**：页面级状态总摊（展开的卡、档案弹层、正在编辑的任务、`atlasPicked/atlasMode`、浮窗位置、导入日志……）。要加状态就加这儿。
- **`PAGES` / `PAGE_CARDS`（`:811` / `:871`）**：页面骨架。`render()`（`:910`）= 顶栏 + 主页或 `pageCards()` + 档案弹层 + 浮窗，末尾 `mountGraph()`。
- **事件**：**全部是 document 级委托**，只有四份监听器——`click`（`:3480`，认 `data-act` / `data-card` / `data-nav`）、`change`（`:3948`）、`submit`（`:4016`）、`keydown`（`:4216`），
  外加浮窗那几条 pointer/dblclick/contextmenu 与 window 的 resize/popstate。

> **加交互不要新增 `addEventListener`**：在 `click` 那份里加一个 `else if (act === 'xxx')` 分支，HTML 里写 `data-act="xxx"`。
> 这样「重新 `render()` 换掉整棵 DOM」不会丢事件。

卡片写法：一个 `xxxCard()` 返回 HTML 字符串，进 `PAGE_CARDS` 的 `main`/`aside`；侧栏模式下要能折叠就用 `fold()`。
正文一律走 `assets/md.js`（**全仓唯一**的 markdown + KaTeX 渲染器，面板 / 读卷页 / 做题页共用，别引 marked）；
数学公式靠 vendored 的 `assets/vendor/katex/`（本地文件，不走 CDN）。

样式规矩（写 CSS 之前先读 [`design.md`](design.md)）：

- 色值 / 字号 / 间距 / 圆角**一律用 `var(--token)`**，token 只认 `assets/style.css` 顶部 `:root` 与 `html[data-theme="light"]` 那两张表。
- `var(--x, 兜底值)` 的兜底值必须跟 `:root` 里的真值**逐字相同**——`test/mirrors.test.js` 钉着这条。
- 方舟层（`style.css` 末尾）只动长相不动布局；造型规矩：一个物件只切一个角、一张图只有一条斜纹、信号青只给当前项/动作/进度。
- `--dsw-alias-*` 是 DSH 主题给的变量，**必须带字面兜底**，而且**别拿 `--dsw-alias-bg-base` 当文字色**：装了壁纸类插件时它会是透明，字就看不见了。

知识图谱在 `assets/graph.js`：零依赖、不碰数据，几何常量定死，HUD 是 `<svg>` 的直接子节点**不能加反向 transform**，
画布**不跟鼠标拖**（改这块之前先看 `AGENTS.md` 那一节和 `test/graph.test.js`）。

## 9. 测试怎么写

`node --test` 跑全量（39 个文件 / 315 个用例）。**不要写 `node --test test/`**——这个 Node 会把目录名当测试文件跑挂。

**面板测试**（`test/panel.test.js`，1684 行 / 33 个用例）用一套假 DOM（`stubDom()`，`:24`）：
`document.querySelector` 直接转给 `window.__query`（夹具想控哪个选择器就临时挂它），事件**只存最后一个监听器**，
`pushState` 会顺手改 `location.pathname`，`localStorage` 是真 Map。

唯一入口是 `boot(fixture(), { path, stale, chat, hidden, sessions, messages, agenda, shelf, review, fail, innerWidth, search })`（`:280`）：

- `hidden: true`：把 `visibilityState` 设成 `'hidden'`，**涉及定时器 / SSE 的用例必须加**，否则前台那条 2.5 秒轮询会让 `node --test` 永远不退出。
- `stale: true`：所有探针路径按 404 回（测那张体检卡）。
- `fail: ['materials/build']`：让某条写接口当场 500。
- 它内部先跑真 `assets/boot.js`，再 `await import(PANEL + '?v=' + random)`——**每个用例一个新模块实例**。

返回句柄：`html()`、`calls`、`posts`、`boxes`、`listeners`、`window`、`sources`（假 EventSource，`sources[0].emit('chat')` 手推一帧）、`documentElement`；
动作助手 `clickAct(dataset, { insideModal })`、`changeAct(dataset, value)`、`submitForm(dataset, fields)`、`clickNav(id)`（返回 `{ jumped }`，**jumped 为 true 就是整页跳了，是失败**）。

一条面板测试的写法：

```js
const page = await boot(fixture(), { path: '/study/map', hidden: true });
assert.match(page.html(), /data-card="map"/);                 // ① 先断言渲染
await page.clickAct({ act: 'group-open', group: '第一大块' }); // ② 再驱动（dataset 键对应 panel.js 里的 el.dataset.*）
assert.deepEqual(page.posts.at(-1), { path: '/study/api/…', body: { … } }); // ③ 断言副作用
```

**图谱测试**（`test/graph.test.js`）自带另一套 `StubElement`，口径是**按数量与结构断言**（`.kg-box` 正好等于大类数、`.kg-halo` ≤ 1、每条连线落在子节点中心线……）。

断言口味：用例名写中文、写清「谁在什么情况下应该看到什么」；**负例要断言「被拒之后盘上什么都没变」**，
不只断言抛了个错；跨文件重复的常量（`STAGES`、`STAGE_NEEDS`、`KIND`）由 `test/mirrors.test.js` 钉住不许重抄。

## 10. 本地验收

```powershell
Set-Location 'F:\dshworkingspace(studyplugin\dsh-study-coach'    # 目录名带左括号，必须加引号
node --test
node scripts/preview.mjs            # 面板起在 19390（真数据根），改前端不必重启 DSH
node scripts/check-live.mjs 19387 19388
```

- **`check-live.mjs` 打的是「新 / 旧」判断题**，判据是「404 且 body 含 `unknown study route`」。
  它打印的「静态资源：panel.js N 字节」其实是 JS 字符串的 `.length`（UTF-16 码元），比磁盘字节小一截是中文注释造成的，**别当成文件被截断**。
- **要证明线上跟磁盘一致，就逐字节比**：
  ```powershell
  Invoke-WebRequest http://127.0.0.1:19387/study/assets/panel.js -OutFile "$env:TEMP\panel.live.js"
  (Get-FileHash assets\panel.js).Hash; (Get-FileHash "$env:TEMP\panel.live.js").Hash
  ```
- **截图**（在浏览器里真看一眼，比读 HTML 靠谱）：用 Edge 的老 headless，新 headless 会报 `Multiple targets are not supported`：
  ```powershell
  & "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe" --headless --disable-gpu `
    --hide-scrollbars --window-size=1500,1400 --virtual-time-budget=9000 `
    --screenshot="$env:TEMP\shot.png" 'http://127.0.0.1:19390/study/map'
  ```
  `--virtual-time-budget` 要给够（面板要等几轮 fetch），`--dump-dom` 是空的、别用。
- 预览用的是**同一个数据根**，跟 DSH 那边别同时写。
- 探活 SSE（`/study/api/events`）**永不结束**，别在前台 `Invoke-WebRequest` 它——会挂住终端，用后台任务，或者干脆别探。

## 11. 发版

- `package.json` 的 `files` 必须含 `index.js, lib, assets, skills, cordis.patch.yml, README.md, PUBLISHING.md, AGENTS.md, design.md, DEV.md, LICENSE`
  （`design.md` / `AGENTS.md` / `DEV.md` 在列是因为 README 链到它们）。**本机的 `node_modules` 是指向 `~/.dsh/profiles/node_modules/@deepseek-ai` 的 junction，别提交。**
- CI（`.github/workflows/ci.yml`）只有 ubuntu + `node: ['22','24']`，`npm install` 是 `continue-on-error`（宿主包拉不到就让测试 skip），最后跑 `node --test`。
- 流程见 [`PUBLISHING.md`](PUBLISHING.md)：`npm pack --dry-run` 核清单 → `git init/add/commit` + `npm run setup-repo`（从 `git remote get-url origin` 抠 owner/repo 填进 `package.json`）→ push → 打 GitHub topic（`dsh-plugin` 必打，市场每天爬一次）→ `npm publish`。
- 日常循环：`node --test` 全绿 → `npm version patch` → `git push --follow-tags` → `npm publish`。
- 改到 `lib/` / `index.js` / `package.json` 的那一版，**发布说明里要提醒用户重启 DSH**，否则他们会看到「页面是新的、按钮全 404」。

## 12. 坑清单（都是真踩过的）

| 坑 | 怎么办 |
| --- | --- |
| 改了 `lib/` 没重启，按钮全 404 | 记住 `assets/*` 与 `lib/client.js` 现读、其它 `lib/*` 要重启；面板会用体检卡把这条喊出来 |
| `node --test test/` 挂 | 只写 `node --test` |
| 目录名 `F:\dshworkingspace(studyplugin` 只有一个左括号 | PowerShell 里一律加引号；写文件路径时别顺手补个 `)`，会落到隔壁目录 |
| 面板主按钮上的字看不见 | 别把 `--dsw-alias-bg-base` 当文字色（壁纸插件下它是透明的）；`--dsw-alias-*` 一律带字面兜底 |
| `var(--x, 兜底)` 与 `:root` 不一致 | `test/mirrors.test.js` 会红；改完 CSS 顺手核对 |
| `new Date('2026-10-01')` 差一天 | 面板里日期一律自己拼字符串 / 用 `weekdayOf()`，别让 UTC 偏移把它挪走 |
| `Library.store()` 顺手造空档案 | 带 `profileId` 的路由先 `storeFor()` 查名册 |
| 探活把终端挂住 | SSE 那条永不结束；`check-live.mjs` 的字节数是 `.length`；用后台任务 |
| `/study/api/point/pages` 当探针会误判 | 旧服务端的 `/study/api/point/:id` 会把 `pages` 当单元 id 接住并回 200；探「看课」那条新路由要用 `/study/api/point/media`（缺参新代码 400、旧代码 404） |
| 看课匹配「人人有份」 | 别拿 3 字公共子串当判据（「题型1」谁都有）；`videoForPoint()` 现在是 80 完全相等 / 60 互相包含且短边 ≥5 字 / 40 公共子串 ≥6，弱匹配一律退成文件夹；改完拿 `.recon-media.mjs` 过一遍真数据 |
| 预览服务器「刚起就死」 | `Start-Job` 起的进程随那次 pwsh 调用结束就没；**起服务器与跑探针 / 截图必须写在同一段脚本里**（`Start-Job -Name preview … Stop-Job`） |
| `--dump-dom` 空、新 headless 报 Multiple targets | 用老 `--headless` + `--virtual-time-budget` + `--screenshot` |

